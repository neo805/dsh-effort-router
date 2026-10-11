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
 *          signals (brief + tool evidence + volume cues + projections)
 *          → classifyStep (cue pipeline; wish floor) → loudest-bump escalate
 *          → frugal demote → route table → clamp max (opt-out) → never-off
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
 * default { low, high, max } table (no off rung: thinking stays on; only
 * absent values are filled, user intent is never overwritten), which makes
 * the native effort selector appear for them.
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
import { createStore, resolveStoreFile } from './store.js'
import { EFFORT_ANCHORS_KEY, effortAnchorsProjection } from './anchors-projection.js'

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
  /** Automatic routing reaches max by default (0.2.0); false collapses it. */
  allowMax: z.boolean().default(true).volatile(),
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
  /** Wish detector: vacuum-zone delegation briefs start at the engineering floor. */
  wish: z.boolean().default(true).volatile(),
  /**
   * Poison recovery: pin `off` when the session history is PROVEN poisoned
   * (a reasoning-less tool-call turn exists AND the decision store recorded a
   * manual off step in this session). Shape alone never pins — models like
   * kimi-K3 emit no reasoning blocks with thinking on.
   */
  poisonRecovery: z.boolean().default(true).volatile(),
  /**
   * Trajectory hoisting: the client decorates the NATIVE trajectory ledger
   * rows with the step's provider/model · effort (DOM projection anchored on
   * data-trajectory-row-key; the host serves the anchor table on the state
   * route). No chat-flow surface, no host package is touched.
   */
  trajectoryAnnotate: z.boolean().default(true).volatile(),

  /**
   * User cue additions, one per line or comma-separated. Merged ON TOP of the
   * shipped dictionaries (strong/normal/cheap/wish). Remount on change.
   */
  cuesStrong: z.string().default(''),
  cuesNormal: z.string().default(''),
  cuesCheap: z.string().default(''),
  cuesWish: z.string().default(''),

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
  allowMax: true,
  maxFallback: 'high',
  subagentEffort: 'inherit',
  fillCustomModels: true,
  frugalDemote: true,
  contextPressure: 0.75,
  sessionTokenBudget: 0,
  wish: true,
  poisonRecovery: true,
  trajectoryAnnotate: true,
  cuesStrong: '',
  cuesNormal: '',
  cuesCheap: '',
  cuesWish: '',
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

/** Split a user cue string (comma / newline / CJK comma separated). */
function parseCueList(value) {
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split(/[,，、;；\n\r]+/).map((w) => w.trim()).filter(Boolean)
}

/**
 * Read the live volatile snapshot as a plain, JSON-stable object. Kept
 * separate from normalization so the (expensive) normalized form can be
 * memoized on this snapshot.
 */
function liveSnapshot(config) {
  return {
    enabled: readVolatile(config.enabled, DEFAULT_CONFIG.enabled),
    defaultLevel: readVolatile(config.defaultLevel, DEFAULT_CONFIG.defaultLevel),
    allowMax: readVolatile(config.allowMax, DEFAULT_CONFIG.allowMax),
    maxFallback: readVolatile(config.maxFallback, DEFAULT_CONFIG.maxFallback),
    subagentEffort: readVolatile(config.subagentEffort, DEFAULT_CONFIG.subagentEffort),
    fillCustomModels: readVolatile(config.fillCustomModels, DEFAULT_CONFIG.fillCustomModels),
    frugalDemote: readVolatile(config.frugalDemote, DEFAULT_CONFIG.frugalDemote),
    contextPressure: readVolatile(config.contextPressure, DEFAULT_CONFIG.contextPressure),
    sessionTokenBudget: readVolatile(config.sessionTokenBudget, DEFAULT_CONFIG.sessionTokenBudget),
    wish: readVolatile(config.wish, DEFAULT_CONFIG.wish),
    poisonRecovery: readVolatile(config.poisonRecovery, DEFAULT_CONFIG.poisonRecovery),
    trajectoryAnnotate: readVolatile(config.trajectoryAnnotate, DEFAULT_CONFIG.trajectoryAnnotate),
    extraCues: {
      strong: parseCueList(readVolatile(config.cuesStrong, '')),
      normal: parseCueList(readVolatile(config.cuesNormal, '')),
      cheap: parseCueList(readVolatile(config.cuesCheap, '')),
      wish: parseCueList(readVolatile(config.cuesWish, '')),
    },
    downAfter: readVolatile(config.downAfter, DEFAULT_CONFIG.downAfter),
    escalateOnErrors: readVolatile(config.escalateOnErrors, DEFAULT_CONFIG.escalateOnErrors),
    escalateOnRepeats: readVolatile(config.escalateOnRepeats, DEFAULT_CONFIG.escalateOnRepeats),
    maxEscalations: readVolatile(config.maxEscalations, DEFAULT_CONFIG.maxEscalations),
    routes: config.routes ?? DEFAULT_CONFIG.routes,
  }
}

/**
 * The resolution gate of the fill-in: of the candidate 'provider/model' keys,
 * keep exactly those whose resolved model info advertises no thinking levels
 * (off/auto don't count). A resolution failure skips the model this round —
 * the next adapters-updated / settings change retries. Exported for tests.
 */
export async function resolveFillTargets(llm, candidates, logger) {
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
      // else: the model already advertises levels (catalog inheritance) — skip silently.
    } catch (error) {
      // Route not ready: skip this round, but SAY it — a permanently failing
      // resolution must be visible, not a silent skip.
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[effort-router] fill candidate ' + key + ' skipped: resolution failed: '
          + String((error && error.message) || error))
      }
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
  // Normalization compiles every cue matcher (~200 regexes); the interceptor
  // and the signal collector both read the live config several times per
  // request step, so memoize on the volatile snapshot and recompile only when
  // a setting actually changes.
  let liveCache = { key: null, value: null }
  const current = () => {
    const snapshot = liveSnapshot(config)
    const key = JSON.stringify(snapshot)
    if (liveCache.key !== key) liveCache = { key, value: normalizePolicyConfig(snapshot) }
    return liveCache.value
  }

  // ---- capability layer ----------------------------------------------------
  const capability = createCapabilityResolver({ llm: () => service('llm') })
  const readvertise = () => {
    capability.clear()
    advertiseAutoMask(service('llm'), logger)
  }
  readvertise()

  // ---- custom-model effort fill-in -----------------------------------------
  // Read the live llm-pi-ai section → candidates = user-layer rows without a
  // reasoningEfforts table → RESOLUTION GATE: keep only models whose resolved
  // info advertises no thinking levels (a catalog model inheriting levels is
  // never shadowed) → pure fill transform (identity when nothing is missing)
  // → whole-field update, so dsh's llm-pi-ai schema validator gates the write
  // where it is written. Writes are queued; a rejection, a settings conflict,
  // or a failed resolution is logged and retried on the next trigger, never
  // fatal.
  //
  // The settings seam is @deepseek-ai/dsh-settings: describe() projects every
  // entry's VOLATILE fields (llm-pi-ai's `providers` is volatile) with a
  // revision, update(ns, patch, expectedRevision) merges and persists through
  // the config editor. There is NO get(ns) — a guard that waits for one
  // silently disables the whole fill (the 0.1.0–0.1.2 bug).
  let syncTail = Promise.resolve()
  const syncCustomModels = () => {
    syncTail = syncTail.then(async () => {
      if (!current().fillCustomModels) return
      const settings = service('settings')
      if (!settings || typeof settings.describe !== 'function' || typeof settings.update !== 'function') {
        logger.warn('[effort-router] settings service exposes no describe/update; custom-model fill is unavailable on this host')
        return
      }
      const descriptor = settings.describe().find((row) => row && row.ns === PI_AI_NAMESPACE)
      if (!descriptor) return
      // Candidates come from the USER layer (the profile override) so the fill
      // never materializes inherited base rows into the override; fall back to
      // the live value when the override is empty.
      const section = descriptor.user && typeof descriptor.user === 'object'
        ? descriptor.user
        : descriptor.value
      if (!section || typeof section !== 'object') return
      const candidates = fillCandidates(section)
      if (candidates.length === 0) return
      const llm = service('llm')
      const targets = await resolveFillTargets(llm, candidates, logger)
      if (targets.length === 0) return
      const { next, filled } = withDefaultEfforts(section, { targets })
      if (next === section || filled.length === 0) return
      await settings.update(PI_AI_NAMESPACE, { providers: next.providers }, descriptor.revision)
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
  // One listener for adapter churn: capabilities change for both subsystems.
  ctx.on('llm/adapters-updated', () => { readvertise(); syncCustomModels() })

  // ---- signals + decision store --------------------------------------------
  const signals = createSignals({
    config: current,
    logger,
    projections: service('sessionProjections'),
  })
  ctx.on('agent/inbox/claimed', (payload) => signals.onClaimed(payload))
  // The store path must come from the host's profileContext service: env
  // fallbacks cannot see the profile inside a Desktop plugin fiber and would
  // silently share the Web profile's file (the 0.2.0 cross-profile race).
  const profile = service('profileContext')
  const storeFile = resolveStoreFile(
    typeof process === 'undefined' ? {} : process.env,
    profile && typeof profile.dir === 'string' ? profile.dir : undefined,
  )
  const store = createStore(storeFile, logger)
  logger.info('[effort-router] decision store: ' + storeFile
    + (profile && profile.name ? ' (profile ' + profile.name + ')' : ''))

  const sessionIdOf = (agent) =>
    (agent && (agent.sessionId || (agent.session && agent.session.id))) || undefined

  const record = (agent, payload, entry, seed) => {
    try {
      store.record(sessionIdOf(agent), {
        at: Date.now(),
        turn: typeof (payload && payload.turn) === 'number' ? payload.turn : null,
        step: typeof (payload && payload.step) === 'number' ? payload.step : null,
        // Route identity lets the echo guard prove "the last decision was ours".
        provider: seed && typeof seed.provider === 'string' ? seed.provider : null,
        model: seed && typeof seed.model === 'string' ? seed.model : null,
        ...entry,
      })
    } catch (_storeFailed) { /* the log is advisory */ }
  }

  /**
   * Selection-echo handling, by PROVENANCE rather than pattern. Background:
   * the host's modelSelection projection mirrors the last stamped request
   * header into the session selection whenever no durable pick exists
   * (`pending === null`), so a scheduled 'auto' — which this plugin resolves
   * to a concrete level before stamping — echoes back on the next step as a
   * fake manual pick (the selector UI flips the same way).
   *
   * Two layers, both anchored in OUR OWN decision store (durable, per
   * session, restart-safe):
   *
   *   1. isSelectionEcho — a concrete seed is an echo iff there is no durable
   *      pick AND the session's last recorded decision was OUR auto schedule
   *      of the same effort on the same route. An explicit pick records
   *      mode 'manual', so consumed-then-cleared picks are never misjudged
   *      (the pending/lastUsed pattern alone cannot tell those apart — the
   *      flaw of the first iteration of this guard).
   *   2. markAutoPending — after scheduling, if no durable pick exists, append
   *      model/selection 'auto' so the session state is honest and the echo
   *      channel closes for good. Skipped for subagent sessions (their
   *      selection state is not ours to write; a future "subagents use auto"
   *      feature flows through seed 'auto' and never touches this).
   */
  const pendingPickOf = (agent) => {
    try {
      const projections = service('sessionProjections')
      if (!projections || typeof projections.stateOf !== 'function' || !agent || !agent.session) return undefined
      const state = projections.stateOf(agent.session, 'modelSelection')
      if (!state) return undefined
      return state.pending ?? null
    } catch (_unreadable) {
      return undefined // unknown: treated as "no durable pick" would be unsafe — callers check for null only
    }
  }

  const isSelectionEcho = (agent, seed, seedEffort) => {
    if (pendingPickOf(agent) !== null) return false
    const last = store.last(sessionIdOf(agent))
    return !!last
      && last.mode === 'auto'
      && last.effort === seedEffort
      && last.provider === seed.provider
      && last.model === seed.model
  }

  const markAutoPending = (agent, seed) => {
    try {
      const session = agent && agent.session
      const header = session && session.header
      if (!session || typeof session.append !== 'function') return
      if (header && Number.isFinite(header.delegationDepth) && header.delegationDepth > 0) return
      if (pendingPickOf(agent) !== null) return
      session.append('model/selection', {
        provider: String(seed.provider),
        model: String(seed.model),
        reasoningEffort: 'auto',
      })
    } catch (_advisory) { /* selection honesty is best-effort */ }
  }

  /**
   * Poison pin, by PROVENANCE rather than shape. The 0.2.0 rule inferred
   * "thinking was off" from a tool-call turn without a reasoning block — but
   * models like kimi-K3 emit no reasoning block before tool calls with
   * thinking ON (measured 2026-10-10, session eb12fb23: K3 @ low showed
   * reasoning blocks on steps 1/3 yet none on the tool-call step 2 of the
   * same turn), so shape alone false-pinned Auto to off forever.
   *
   * The pin now needs BOTH:
   *   - shape suspect (signals: a reasoning-less tool-call turn exists — the
   *     payload a strict thinking-mode API would reject), AND
   *   - store proof: a step in THIS session actually ran at a MANUAL off
   *     (mode 'manual', effort 'off'). Only manual decisions count: auto
   *     never routes off (rule 4), so an auto 'off' record can only come from
   *     a degenerate advertised vocabulary — counting it would self-sustain.
   * The pin still lifts when compaction removes the offending turn (the shape
   * flag is re-derived on projection shrink).
   */
  const storeProvenManualOff = (sessionId) =>
    store.recent(sessionId).some((d) => d && d.mode === 'manual' && d.effort === 'off')

  // ---- the interceptor ------------------------------------------------------
  // prepend: the host's model-selection assembly also listens on this event and
  // applies the session selection after next(); registering first keeps this
  // plugin's decision OUTERMOST so it runs last.
  ctx.on('agent/request', async (payload, next) => {
    const seed = await next()
    try {
      const cfg = current()
      if (!cfg.enabled) {
        // The auto mask is OUR advertisement, unknown to the model: strip it
        // even when disabled, or prepareCall may reject the request.
        if (seed && seed.reasoningEffort === 'auto') {
          const stripped = { ...seed }
          delete stripped.reasoningEffort
          return stripped
        }
        return seed
      }
      const agent = payload && payload.agent
      if (!agent) return seed
      rememberSession(agent)

      const cap = await capability.resolve(seed.provider, seed.model)
      const seedEffort = typeof seed.reasoningEffort === 'string' ? seed.reasoningEffort : undefined
      let selectionEcho = false

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
          }, seed)
          return stripped
        }
        if (isSelectionEcho(agent, seed, seedEffort)) {
          // Our own scheduled value echoed back through lastUsed: not a pick.
          selectionEcho = true
        } else {
          record(agent, payload, {
            mode: 'manual', effort: seedEffort, tier: null, stepClass: null, score: null, reason: '',
          }, seed)
          return seed
        }
      }

      // Capability guard: never send an effort to a model without reasoning
      // metadata — strip an inherited one so the request is not rejected.
      if (!cap.supportsReasoning) {
        const stripped = { ...seed }
        delete stripped.reasoningEffort
        record(agent, payload, {
          mode: 'unsupported', effort: null, tier: null, stepClass: null, score: null,
          reason: 'model advertises no reasoning effort',
        }, seed)
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
        }, seed)
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
        }, seed)
        return out
      }

      // Scheduled path: classify → escalate/demote → route → clamp → hysteresis.
      // Poison pin: shape suspect AND store proof (see storeProvenManualOff);
      // shape alone is never enough.
      sig.poisonedHistory = cfg.poisonRecovery === true
        && sig.offShapeHistory === true
        && storeProvenManualOff(sessionIdOf(agent))
      const decision = decideEffort(cfg, sig)
      // A poisoned pin applies IMMEDIATELY, bypassing hysteresis: routing it
      // through stabilizeEffort would hold the previous thinking-on tier for
      // downAfter steps and send exactly the request the pin exists to
      // prevent (a 0.2.0 bug).
      const stable = decision.poisoned
        ? { tier: decision.tier, held: false }
        : signals.stabilizeEffort(agent, decision.tier, cfg.downAfter)
      const reason = [...decision.reason]
      if (selectionEcho) reason.push('selection echo of a scheduled header (no durable pick); rescheduled')
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
      }, seed)
      // Close the echo channel at the source: with no durable pick, stamp
      // 'auto' as the session's pending selection so the host stops
      // rebuilding the selection from our scheduled header (the selector UI
      // keeps showing Auto too). A durable concrete pick is never touched.
      if (!decision.poisoned) markAutoPending(agent, seed)
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

  // ---- read-only state route (composer badge + trajectory anchors) ----------
  // Live session registry: the trajectory anchor table lives in a session
  // projection, which is addressed by the session OBJECT — the route only has
  // the id. Bounded; entries are just references the host already holds.
  const sessionRefs = new Map()
  const rememberSession = (agent) => {
    const id = sessionIdOf(agent)
    const session = agent && agent.session
    if (!id || !session) return
    if (sessionRefs.has(id)) sessionRefs.delete(id)
    sessionRefs.set(id, session)
    while (sessionRefs.size > 100) sessionRefs.delete(sessionRefs.keys().next().value)
  }
  const anchorsOfSession = (session, projections) => {
    try {
      const state = projections.stateOf(session, EFFORT_ANCHORS_KEY)
      return state && state.anchors ? state.anchors : null
    } catch (_unreadable) {
      return null
    }
  }
  // Anchor keys are globally unique ids (assistant message uuids, tool call
  // ids), so merging several sessions' tables is collision-safe: rows of the
  // session actually on screen resolve, every other key simply never matches.
  // The client needs this merged fallback because the shell URL does not
  // always expose the session id to DOM-level plugins.
  const ANCHOR_MERGE_SESSIONS = 8
  const anchorsOf = (sessionId) => {
    try {
      const projections = service('sessionProjections')
      if (!projections || typeof projections.stateOf !== 'function') return null
      const known = sessionId ? sessionRefs.get(sessionId) : undefined
      if (known) return anchorsOfSession(known, projections)
      const merged = {}
      let sessions = 0
      for (const session of Array.from(sessionRefs.values()).reverse()) {
        if (sessions >= ANCHOR_MERGE_SESSIONS) break
        const anchors = anchorsOfSession(session, projections)
        if (!anchors) continue
        sessions += 1
        Object.assign(merged, anchors)
      }
      return sessions > 0 ? merged : null
    } catch (_unreadable) {
      return null
    }
  }
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
            trajectoryAnnotate: cfg.trajectoryAnnotate,
            last: store.last(sessionId) ?? null,
            recent: store.recent(sessionId),
            anchors: anchorsOf(sessionId),
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      }
      return scope.webServer.register({ kind: 'exact', path: '/effort-router/state', handler })
    }, 'effort-router: state route')
  })

  // ---- per-step effort anchors (native trajectory decoration) ----------------
  ctx.inject(['sessionProjections'], (scope) => {
    scope.effect(
      () => scope.sessionProjections.register(effortAnchorsProjection),
      'effort-router: anchors projection',
    )
  })
}
