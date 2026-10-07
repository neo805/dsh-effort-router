/**
 * dsh-effort-router — host plugin.
 *
 * Per-step reasoning-effort routing for every reasoning-capable model:
 *
 *   agent/request (waterfall, prepend)
 *     seed = host-resolved request (model + the session's selected effort)
 *     ├─ seed.reasoningEffort is a concrete level  → MANUAL: pass through
 *     │    verbatim when the model advertises it, strip otherwise
 *     ├─ seed.reasoningEffort absent and defaultLevel concrete → fixed inject
 *     ├─ subagent with no explicit effort and subagentEffort set → that level
 *     └─ otherwise (auto mask or defaultLevel=auto) → SCHEDULE:
 *          signals (brief + tool evidence + projections)
 *          → classifyStep → escalate on evidence → frugal demote
 *          → route table → clamp max (opt-in) → never-off
 *          → hysteresis (downAfter) → mapEffort to advertised vocabulary
 *
 * Capability guard: a model without reasoning metadata never receives the
 * field (the host rejects it per request with UNSUPPORTED_REASONING_EFFORT).
 *
 * Failure posture: the interceptor is wrapped in one try/catch and returns the
 * seed untouched on any error — degradation here means "no opinion", never a
 * broken request.
 *
 * Custom models: on startup and on llm-pi-ai settings changes, hand-declared
 * custom-gateway models without a reasoningEfforts table are filled with the
 * default { off, high, max } table (only absent values; user intent is never
 * overwritten), which makes the native effort selector appear for them.
 *
 * Parts adapted under MIT from @neptune810/dsh-model-router (classification
 * pipeline, signals, store, projection) and dsh-thinking-levels (capability
 * guard, auto-mask advertisement, volatile config pattern). See README.
 */
import z from '@deepseek-ai/schemastery'
import { decideEffort, normalizePolicyConfig } from './policy.js'
import { mapEffort } from './routing.js'
import { createSignals } from './signals.js'
import { advertiseAutoMask, createCapabilityResolver } from './capability.js'
import { PI_AI_NAMESPACE, fillCandidates, withDefaultEfforts } from './custom-models.js'
import { createStore } from './store.js'
import { effortRouteProjection } from './route-projection.js'

export const name = 'dsh-effort-router'
export const inject = []

/** Standard level vocabulary (selector ids; wire spelling is adapter-owned). */
const LEVELS = ['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Composition-entry schema. `.volatile()` fields apply at runtime without a
 * plugin remount (the settings card writes them through configForms); ordinary
 * fields (routes table, thresholds) remount the fiber on change.
 */
export const Config = z.object({
  /** Master switch. Off = requests pass through untouched. */
  enabled: z.boolean().default(true).volatile(),
  /**
   * The level applied when a request carries NO explicit selection. 'auto'
   * schedules per step; a concrete level pins every unselected request.
   */
  defaultLevel: z.union(['auto', ...LEVELS]).default('auto').volatile(),
  /** Automatic routing never reaches max while this is false (opt-in). */
  allowMax: z.boolean().default(false).volatile(),
  /** What a scheduled max collapses to while allowMax is false. */
  maxFallback: z.union(['low', 'high']).default('high').volatile(),
  /** Subagent default: applied only when the subagent request has no explicit effort. */
  subagentEffort: z.union(['inherit', ...LEVELS]).default('inherit').volatile(),
  /** Fill default reasoningEfforts for hand-declared llm-pi-ai custom models. */
  fillCustomModels: z.boolean().default(true).volatile(),
  /** Let frugal signals (context pressure / budget / subagent) demote one class. */
  frugalDemote: z.boolean().default(true).volatile(),
  /** Context occupancy ratio at or above which the frugal signal fires; 0 disables. */
  contextPressure: z.number().min(0).max(1).default(0.75).volatile(),
  /** Session token total at or above which the frugal signal fires; 0 disables. */
  sessionTokenBudget: z.number().step(1).min(0).default(0).volatile(),

  /** Downgrades need this many consecutive quieter decisions before they apply. */
  downAfter: z.number().step(1).min(1).max(5).default(2),
  /** Evidence thresholds, counted inside one task. */
  escalateOnErrors: z.number().step(1).min(1).max(10).default(2),
  escalateOnRepeats: z.number().step(1).min(2).max(10).default(3),
  maxEscalations: z.number().step(1).min(1).max(3).default(2),
  /** Class -> tier route table (low/high/max only: off is never a route). */
  routes: z.object({
    trivial: z.union(['low', 'high']).default('low'),
    standard: z.union(['low', 'high']).default('low'),
    engineering: z.union(['low', 'high', 'max']).default('high'),
    hard: z.union(['high', 'max']).default('max'),
  }).default({ trivial: 'low', standard: 'low', engineering: 'high', hard: 'max' }),
})

/** Settings defaults, kept in lockstep with the schema defaults above. */
export const DEFAULT_CONFIG = {
  enabled: true,
  defaultLevel: 'auto',
  allowMax: false,
  maxFallback: 'high',
  subagentEffort: 'inherit',
  fillCustomModels: true,
  frugalDemote: true,
  contextPressure: 0.75,
  sessionTokenBudget: 0,
  downAfter: 2,
  escalateOnErrors: 2,
  escalateOnRepeats: 3,
  maxEscalations: 2,
  routes: { trivial: 'low', standard: 'low', engineering: 'high', hard: 'max' },
}

/**
 * Read a `.volatile()` field: a live Volatile ref on a DSH 0.1.7+/0.2 host, a
 * plain value otherwise. Undefined reads fall back to the schema default.
 */
export function readVolatile(value, fallback) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    const snapshot = value.get()
    return snapshot === undefined ? fallback : snapshot
  }
  return value ?? fallback
}

/**
 * Resolve the live configuration snapshot and normalize it for the policy
 * (validates the routes table, merges scoring defaults and cue lists).
 */
function resolveLiveConfig(config) {
  return normalizePolicyConfig({
    enabled: readVolatile(config.enabled, DEFAULT_CONFIG.enabled),
    defaultLevel: readVolatile(config.defaultLevel, DEFAULT_CONFIG.defaultLevel),
    allowMax: readVolatile(config.allowMax, DEFAULT_CONFIG.allowMax),
    maxFallback: readVolatile(config.maxFallback, DEFAULT_CONFIG.maxFallback),
    subagentEffort: readVolatile(config.subagentEffort, DEFAULT_CONFIG.subagentEffort),
    fillCustomModels: readVolatile(config.fillCustomModels, DEFAULT_CONFIG.fillCustomModels),
    frugalDemote: readVolatile(config.frugalDemote, DEFAULT_CONFIG.frugalDemote),
    contextPressure: readVolatile(config.contextPressure, DEFAULT_CONFIG.contextPressure),
    sessionTokenBudget: readVolatile(config.sessionTokenBudget, DEFAULT_CONFIG.sessionTokenBudget),
    downAfter: readVolatile(config.downAfter, DEFAULT_CONFIG.downAfter),
    escalateOnErrors: readVolatile(config.escalateOnErrors, DEFAULT_CONFIG.escalateOnErrors),
    escalateOnRepeats: readVolatile(config.escalateOnRepeats, DEFAULT_CONFIG.escalateOnRepeats),
    maxEscalations: readVolatile(config.maxEscalations, DEFAULT_CONFIG.maxEscalations),
    routes: config.routes ?? DEFAULT_CONFIG.routes,
  })
}

/**
 * The resolution gate of the fill-in: of the candidate 'provider/model' keys,
 * keep exactly those whose resolved model info advertises no thinking levels
 * (off/auto don't count). A resolution failure skips the model this round —
 * the next adapters-updated / settings change retries. Exported for tests.
 */
export async function resolveFillTargets(llm, candidates) {
  const targets = []
  if (!llm || typeof llm.resolveModelInfo !== 'function') return targets
  for (const key of candidates) {
    const slash = key.indexOf('/')
    try {
      const info = await llm.resolveModelInfo(key.slice(0, slash), key.slice(slash + 1))
      const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts)
        ? info.reasoning.efforts
            .map((effort) => effort && effort.id)
            .filter((id) => typeof id === 'string' && id !== 'off' && id !== 'auto')
        : []
      if (efforts.length === 0) targets.push(key)
    } catch {
      // route not ready: skip this round
    }
  }
  return targets
}

/** JSON response helper for the read-only state route. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body === undefined ? null : body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Plugin body.
 * @param ctx - host context carrying the agent-event dispatch.
 * @param config - resolved plugin configuration (schema-validated entry).
 */
export function apply(ctx, config = DEFAULT_CONFIG) {
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger('effort-router')
    : (ctx.logger && typeof ctx.logger.info === 'function' ? ctx.logger : console)
  const service = (serviceName) => { try { return ctx.get(serviceName) } catch (_missing) { return undefined } }
  const current = () => resolveLiveConfig(config)

  // ---- capability layer ----------------------------------------------------
  const capability = createCapabilityResolver({ llm: () => service('llm') })
  const readvertise = () => {
    capability.clear()
    advertiseAutoMask(service('llm'), logger)
  }
  readvertise()
  ctx.on('llm/adapters-updated', () => readvertise())

  // ---- custom-model effort fill-in -----------------------------------------
  // Read the live llm-pi-ai section → candidates = user-layer rows without a
  // reasoningEfforts table → RESOLUTION GATE: keep only models whose resolved
  // info advertises no thinking levels (a catalog model inheriting levels is
  // never shadowed) → pure fill transform (identity when nothing is missing)
  // → whole-section update, so dsh's llm-pi-ai schema validator gates the
  // write where it is written. Writes are queued; a rejection or a failed
  // resolution is logged and retried on the next trigger, never fatal.
  let syncTail = Promise.resolve()
  const syncCustomModels = () => {
    syncTail = syncTail.then(async () => {
      if (!current().fillCustomModels) return
      const settings = service('settings')
      if (!settings || typeof settings.get !== 'function' || typeof settings.update !== 'function') return
      const section = settings.get(PI_AI_NAMESPACE)
      const candidates = fillCandidates(section)
      if (candidates.length === 0) return
      const llm = service('llm')
      const targets = await resolveFillTargets(llm, candidates)
      if (targets.length === 0) return
      const { next, filled } = withDefaultEfforts(section, { targets })
      if (next === section || filled.length === 0) return
      await settings.update(PI_AI_NAMESPACE, { providers: next.providers })
      // Capabilities changed: re-resolve on the next request.
      capability.clear()
      logger.info('[effort-router] filled default reasoningEfforts for ' + filled.length
        + ' custom model(s): ' + filled.join(', '))
    }).catch((error) => {
      logger.warn('[effort-router] custom-model effort fill rejected (schema gate); kept previous section: '
        + String((error && error.message) || error))
    })
  }
  syncCustomModels()
  ctx.on('settings/document-updated', (ns) => { if (ns === PI_AI_NAMESPACE) syncCustomModels() })
  ctx.on('llm/adapters-updated', () => syncCustomModels())

  // ---- signals + decision store --------------------------------------------
  const signals = createSignals({
    config: current,
    logger,
    projections: service('sessionProjections'),
  })
  ctx.on('agent/inbox/claimed', (payload) => signals.onClaimed(payload))
  const store = createStore()

  const sessionIdOf = (agent) =>
    (agent && (agent.sessionId || (agent.session && agent.session.id))) || undefined

  const record = (agent, payload, entry) => {
    try {
      store.record(sessionIdOf(agent), {
        at: Date.now(),
        turn: typeof (payload && payload.turn) === 'number' ? payload.turn : null,
        step: typeof (payload && payload.step) === 'number' ? payload.step : null,
        ...entry,
      })
    } catch (_storeFailed) { /* the log is advisory */ }
  }

  // ---- the interceptor ------------------------------------------------------
  // prepend: the host's model-selection assembly also listens on this event and
  // applies the session selection after next(); registering first keeps this
  // plugin's decision OUTERMOST so it runs last.
  ctx.on('agent/request', async (payload, next) => {
    const seed = await next()
    try {
      const cfg = current()
      if (!cfg.enabled) return seed
      const agent = payload && payload.agent
      if (!agent) return seed

      const cap = await capability.resolve(seed.provider, seed.model)
      const seedEffort = typeof seed.reasoningEffort === 'string' ? seed.reasoningEffort : undefined

      // Manual pick: a concrete, non-auto level is an explicit user (or
      // orchestrator) choice. Pass it through verbatim when the model
      // advertises it; strip it otherwise — an unadvertised level would be
      // rejected per request, and we never clamp an explicit choice.
      if (seedEffort !== undefined && seedEffort !== 'auto') {
        if (!cap.supportsReasoning || !cap.efforts.includes(seedEffort)) {
          const stripped = { ...seed }
          delete stripped.reasoningEffort
          record(agent, payload, {
            mode: 'manual-stripped', effort: null, tier: null, stepClass: null, score: null,
            reason: 'model does not advertise "' + seedEffort + '"; stripped',
          })
          return stripped
        }
        record(agent, payload, {
          mode: 'manual', effort: seedEffort, tier: null, stepClass: null, score: null, reason: '',
        })
        return seed
      }

      // Capability guard: never send an effort to a model without reasoning
      // metadata — strip an inherited one so the request is not rejected.
      if (!cap.supportsReasoning) {
        const stripped = { ...seed }
        delete stripped.reasoningEffort
        record(agent, payload, {
          mode: 'unsupported', effort: null, tier: null, stepClass: null, score: null,
          reason: 'model advertises no reasoning effort',
        })
        return stripped
      }

      // Pinned default: defaultLevel concrete applies when nothing is selected.
      if (seedEffort === undefined && cfg.defaultLevel !== 'auto') {
        const effort = mapEffort(cfg.defaultLevel, cap.efforts)
        const out = { ...seed }
        if (effort === undefined) delete out.reasoningEffort
        else out.reasoningEffort = effort
        record(agent, payload, {
          mode: 'default', effort: effort ?? null, tier: cfg.defaultLevel,
          stepClass: null, score: null, reason: 'pinned default level',
        })
        return out
      }

      // Subagent default: only fills requests with no explicit effort.
      const sig = signals.collect(agent, payload)
      if (sig.delegationDepth > 0 && cfg.subagentEffort !== 'inherit') {
        const effort = mapEffort(cfg.subagentEffort, cap.efforts)
        const out = { ...seed }
        if (effort === undefined) delete out.reasoningEffort
        else out.reasoningEffort = effort
        record(agent, payload, {
          mode: 'subagent', effort: effort ?? null, tier: cfg.subagentEffort,
          stepClass: null, score: null, reason: 'subagent default (depth ' + sig.delegationDepth + ')',
        })
        return out
      }

      // Scheduled path: classify → escalate/demote → route → clamp → hysteresis.
      const decision = decideEffort(cfg, sig)
      const stable = signals.stabilizeEffort(agent, decision.tier, cfg.downAfter)
      const reason = [...decision.reason]
      if (stable.held) reason.push('hysteresis: holding ' + stable.tier)
      const effort = mapEffort(stable.tier, cap.efforts)

      const out = { ...seed }
      if (effort === undefined) {
        delete out.reasoningEffort
        reason.push('target model advertises no reasoning effort')
      } else {
        out.reasoningEffort = effort
      }
      record(agent, payload, {
        mode: decision.poisoned ? 'poisoned' : 'auto',
        effort: effort ?? null,
        tier: stable.tier,
        stepClass: decision.stepClass,
        score: decision.score,
        reason: reason.join('; '),
      })
      logger.info(
        '[effort-router] ' + (sessionIdOf(agent) || 'session') +
        ' turn ' + (payload && payload.turn) + ' step ' + (payload && payload.step) +
        ' class ' + decision.stepClass + ' score ' + decision.score +
        ' -> ' + String(seed.provider) + '/' + String(seed.model) +
        ' effort ' + (effort ?? 'default') +
        (reason.length ? ' [' + reason.join(', ') + ']' : ''),
      )
      return out
    } catch (error) {
      logger.warn('[effort-router] interceptor failed; passing the request through: '
        + String((error && error.message) || error))
      return seed
    }
  }, { prepend: true })

  // ---- read-only state route for the composer badge -------------------------
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') || undefined
          const cfg = current()
          sendJson(res, 200, {
            ok: true,
            enabled: cfg.enabled,
            defaultLevel: cfg.defaultLevel,
            last: store.last(sessionId) ?? null,
            recent: store.recent(sessionId),
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      }
      return scope.webServer.register({ kind: 'exact', path: '/effort-router/state', handler })
    }, 'effort-router: state route')
  })

  // ---- per-tool-call effort projection (chat annotations) -------------------
  ctx.inject(['sessionProjections'], (scope) => {
    scope.effect(
      () => scope.sessionProjections.register(effortRouteProjection),
      'effort-router: route projection',
    )
  })
}
