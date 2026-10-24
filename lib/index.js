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
 *     └─ otherwise (auto mask or defaultLevel=auto) → SCHEDULE (0.2.8 drift):
 *          signals (origin anchor + short/long windows + projections)
 *          → decideEffort: clamp(origin + error channel + volume channel
 *            − frugal; trivial origin caps the lift; warm-up floor)
 *          → route table → clamp max (opt-out) → never-off
 *          → mapEffort to advertised vocabulary
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
 * default { low, high, max } table (no off rung: thinking stays on), which
 * makes the native effort selector appear for them. Only PROFILE-layer rows
 * are candidates (0.2.1): a model the settings user layer already owns is
 * never touched, because the Models page's reasoning-effort switch stores
 * OFF by removing the field — re-filling it would undo an explicit choice.
 *
 * Parts adapted under MIT from @neptune810/dsh-model-router (classification
 * pipeline, signals, store, projection) and dsh-thinking-levels (capability
 * guard, auto-mask advertisement, volatile config pattern). See README.
 */
import { createHash } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { decideEffort, normalizePolicyConfig, POLICY_DEFAULTS } from './policy.js'
import { effortForRank, mapEffort } from './routing.js'
import { createSignals } from './signals.js'
import { createCompressor } from './compress.js'
import { advertiseAutoMask, createCapabilityResolver } from './capability.js'
import { PI_AI_NAMESPACE, fillCandidates, planFill, userOwnsModel } from './custom-models.js'
import { createStore, resolveStoreFile } from './store.js'
import { EFFORT_ANCHORS_KEY, effortAnchorsProjection } from './anchors-projection.js'
import { resolveMergedAnchors } from './anchors-resolve.js'

export const name = 'dsh-effort-router'
export const inject = []

/** Standard level vocabulary (selector ids; wire spelling is adapter-owned). */
const LEVELS = ['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const ROUTE_TIERS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/**
 * Composition-entry schema. `.volatile()` fields apply at runtime without a
 * plugin remount (live refs the host re-reads on change); ordinary fields
 * (routes table, thresholds) remount the fiber on change. There is no
 * settings UI (0.2.7-rc.6): this schema is the whole user-facing contract —
 * options are edited in the profile-side plugin config, which package
 * upgrades never overwrite.
 */
export const Config = z.object({
  /** Master switch. Off = requests pass through untouched. */
  enabled: z.boolean().default(true).volatile(),
  /**
   * The level applied when a request carries NO explicit selection. 'auto'
   * schedules per step; a concrete level pins every unselected request.
   */
  defaultLevel: z.union(['auto', ...LEVELS]).default('auto').volatile(),
  /** Deprecated 0.2.16: migrated to a global allow-list ceiling. */
  allowMax: z.boolean().default(true).volatile(),
  /** Deprecated 0.2.16: legacy ceiling used only when migrating allowMax=false. */
  maxFallback: z.union(['low', 'high']).default('high').volatile(),
  /**
   * Global final selector-id allow-list (0.2.16). Empty = every advertised
   * non-off level. Canonical labels only; off/none/auto are reserved.
   */
  allowedEfforts: z.array(z.string()).default([]),
  /** Missing target behaviour: nearest-up (compat), up, or down. */
  effortFallback: z.union(['nearest-up', 'up', 'down']).default('nearest-up'),
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
   * Composer badge: show the read-only mode · effort pill next to the model
   * selector (conversation.input.right). Display only — scheduling is
   * unaffected. False hides the pill.
   */
  showBadge: z.boolean().default(true).volatile(),
  /**
   * Chat-flow captions: project each tool call's provider/model · effort as a
   * compact caption row under the call in the conversation view (the R1
   * surface, revived on maintainer's call 0.2.7-rc.7). DEFAULT OFF — the chat
   * flow stays clean unless the user opts in. The client reads the flag once
   * at load, so a toggle applies on page reload.
   */
  chatAnnotate: z.boolean().default(false).volatile(),

  /**
   * User cue additions, one per line or comma-separated. Merged ON TOP of the
   * shipped dictionaries (strong/normal/cheap/wish). Remount on change.
   */
  cuesStrong: z.string().default(''),
  cuesNormal: z.string().default(''),
  cuesCheap: z.string().default(''),
  cuesWish: z.string().default(''),

  /**
   * Full dictionary replacement, one cue per line or comma-separated. When
   * non-blank, this list IS the whole dictionary — the shipped list is
   * dropped, deletions included; the matching cues<Name> additions still
   * merge on top. Blank (default) = shipped dictionary. Read the effective
   * lists from GET /effort-router/dictionaries before editing. Remount on
   * change.
   */
  dictStrong: z.string().default(''),
  dictNormal: z.string().default(''),
  dictCheap: z.string().default(''),
  dictWish: z.string().default(''),

  /**
   * DEPRECATED (0.2.8): hysteresis is retired — with the 6-step short
   * window the evidence itself decays fast enough. The key stays so old
   * config files still validate; the value is ignored.
   */
  downAfter: z.number().step(1).min(1).max(5).default(2),
  /** Channel ① thresholds, counted inside the SHORT window (decay-weighted). */
  escalateOnErrors: z.number().step(1).min(1).max(10).default(1),
  escalateOnRepeats: z.number().step(1).min(2).max(10).default(3),
  /** Cap on the error channel's total bump (evidence + todo + carry). */
  maxEscalations: z.number().step(1).min(1).max(3).default(2),
  /** Channel ① short window: tool batches kept for error/repeat sums. */
  shortWindow: z.number().step(1).min(2).max(16).default(6),
  /** Per-bucket decay weights, newest → oldest, comma-separated (e.g. "1,0.8,0.6,0.5,0.4,0.3"). */
  errorDecay: z.string().default('1,0.8,0.6,0.5,0.4,0.3'),
  /** A todo completing inside the short window bumps +1 (next subtask starts). */
  todoBump: z.boolean().default(true).volatile(),
  /** A subagent/workflow result landing inside the short window bumps +1 (integration step). */
  subagentReturnBump: z.boolean().default(true).volatile(),
  /** A compaction checkpoint landing inside the short window bumps +1 (peak map-fidelity risk). */
  compactionBump: z.boolean().default(true).volatile(),
  /** Channel ② long window: tool batches summed for information volume. */
  longWindow: z.number().step(1).min(4).max(128).default(32),
  /** Brief volume ramp (effective tokens, comma-separated ascending rungs). */
  briefRamp: z.string().default('400,1600'),
  /** Tool-result volume ramp (effective tokens, comma-separated ascending rungs). */
  toolRamp: z.string().default('48000,128000'),
  /** Discount window sums by the gzip compression ratio (repetition ≠ information). */
  compressDiscount: z.boolean().default(true).volatile(),
  /** Channel ④: the origin class is the floor for this many steps of a task; 0 disables. */
  warmUpSteps: z.number().step(1).min(0).max(10).default(3),
  /** Total drift lift allowed on a trivial origin (paste size ≠ difficulty). */
  trivialLiftCap: z.number().step(1).min(0).max(3).default(1),
  /** Class -> origin tier. off/none/auto are never route targets (rule 4). */
  routes: z.object({
    trivial: z.union(ROUTE_TIERS).default('low'),
    standard: z.union(ROUTE_TIERS).default('low'),
    engineering: z.union(ROUTE_TIERS).default('high'),
    hard: z.union(ROUTE_TIERS).default('max'),
  }).default({ trivial: 'low', standard: 'low', engineering: 'high', hard: 'max' }),
})

/** Settings defaults, kept in lockstep with the schema defaults above. */
export const DEFAULT_CONFIG = {
  enabled: true,
  defaultLevel: 'auto',
  allowMax: true,
  maxFallback: 'high',
  allowedEfforts: [],
  effortFallback: 'nearest-up',
  subagentEffort: 'inherit',
  fillCustomModels: true,
  frugalDemote: true,
  contextPressure: 0.75,
  sessionTokenBudget: 0,
  wish: true,
  poisonRecovery: true,
  trajectoryAnnotate: true,
  showBadge: true,
  chatAnnotate: false,
  cuesStrong: '',
  cuesNormal: '',
  cuesCheap: '',
  cuesWish: '',
  dictStrong: '',
  dictNormal: '',
  dictCheap: '',
  dictWish: '',
  downAfter: 2, // deprecated (0.2.8), ignored
  escalateOnErrors: 1,
  escalateOnRepeats: 3,
  maxEscalations: 2,
  shortWindow: 6,
  errorDecay: '1,0.8,0.6,0.5,0.4,0.3',
  todoBump: true,
  subagentReturnBump: true,
  compactionBump: true,
  longWindow: 32,
  briefRamp: '400,1600',
  toolRamp: '48000,128000',
  compressDiscount: true,
  warmUpSteps: 3,
  trivialLiftCap: 1,
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
 * Remove this plugin's virtual Auto sentinel while preserving the fail-open
 * identity contract for every concrete request. Used by BOTH the disabled path
 * and the total interceptor catch: no error may leak Auto to the host.
 */
function stripAutoEffort(seed) {
  if (!seed || seed.reasoningEffort !== 'auto') return seed
  const stripped = { ...seed }
  delete stripped.reasoningEffort
  return stripped
}

/** Long-window repeat keys keep full equality semantics without full payloads. */
function fingerprintArguments(canonical) {
  return createHash('sha256').update(canonical).digest('hex')
}

/** Split a user cue string (comma / newline / CJK comma separated). */
function parseCueList(value) {
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split(/[,，、;；\n\r]+/).map((w) => w.trim()).filter(Boolean)
}

/**
 * Parse a comma-separated number vector (ramps / decay weights) into a plain
 * array; undefined when blank so the policy default applies. Element-level
 * validation lives in normalizePolicyConfig (sanitizeRamp/sanitizeWeights).
 */
function parseNumberList(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const out = value.split(/[,，、;；\n\r]+/).map((w) => Number(w.trim())).filter((n) => Number.isFinite(n))
  return out.length > 0 ? out : undefined
}

/** Full-replacement dictionary: undefined when blank (see liveSnapshot). */
function parseDictList(value) {
  const list = parseCueList(value)
  return list.length > 0 ? list : undefined
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
    allowedEfforts: readVolatile(config.allowedEfforts, DEFAULT_CONFIG.allowedEfforts),
    effortFallback: readVolatile(config.effortFallback, DEFAULT_CONFIG.effortFallback),
    subagentEffort: readVolatile(config.subagentEffort, DEFAULT_CONFIG.subagentEffort),
    fillCustomModels: readVolatile(config.fillCustomModels, DEFAULT_CONFIG.fillCustomModels),
    frugalDemote: readVolatile(config.frugalDemote, DEFAULT_CONFIG.frugalDemote),
    contextPressure: readVolatile(config.contextPressure, DEFAULT_CONFIG.contextPressure),
    sessionTokenBudget: readVolatile(config.sessionTokenBudget, DEFAULT_CONFIG.sessionTokenBudget),
    wish: readVolatile(config.wish, DEFAULT_CONFIG.wish),
    poisonRecovery: readVolatile(config.poisonRecovery, DEFAULT_CONFIG.poisonRecovery),
    trajectoryAnnotate: readVolatile(config.trajectoryAnnotate, DEFAULT_CONFIG.trajectoryAnnotate),
    showBadge: readVolatile(config.showBadge, DEFAULT_CONFIG.showBadge),
    chatAnnotate: readVolatile(config.chatAnnotate, DEFAULT_CONFIG.chatAnnotate),
    extraCues: {
      strong: parseCueList(readVolatile(config.cuesStrong, '')),
      normal: parseCueList(readVolatile(config.cuesNormal, '')),
      cheap: parseCueList(readVolatile(config.cuesCheap, '')),
      wish: parseCueList(readVolatile(config.cuesWish, '')),
    },
    // Full-replacement dictionaries: undefined (NOT an empty array) when the
    // key is blank — normalizePolicyConfig treats any array, even empty, as
    // "this IS the dictionary", so an empty array would wipe the shipped list.
    dictionaries: {
      strong: parseDictList(readVolatile(config.dictStrong, '')),
      normal: parseDictList(readVolatile(config.dictNormal, '')),
      cheap: parseDictList(readVolatile(config.dictCheap, '')),
      wish: parseDictList(readVolatile(config.dictWish, '')),
    },
    // downAfter is deprecated (0.2.8): read for snapshot stability, never used.
    escalateOnErrors: readVolatile(config.escalateOnErrors, DEFAULT_CONFIG.escalateOnErrors),
    escalateOnRepeats: readVolatile(config.escalateOnRepeats, DEFAULT_CONFIG.escalateOnRepeats),
    maxEscalations: readVolatile(config.maxEscalations, DEFAULT_CONFIG.maxEscalations),
    shortWindow: readVolatile(config.shortWindow, DEFAULT_CONFIG.shortWindow),
    errorDecay: parseNumberList(readVolatile(config.errorDecay, DEFAULT_CONFIG.errorDecay)),
    todoBump: readVolatile(config.todoBump, DEFAULT_CONFIG.todoBump),
    subagentReturnBump: readVolatile(config.subagentReturnBump, DEFAULT_CONFIG.subagentReturnBump),
    compactionBump: readVolatile(config.compactionBump, DEFAULT_CONFIG.compactionBump),
    longWindow: readVolatile(config.longWindow, DEFAULT_CONFIG.longWindow),
    briefRamp: parseNumberList(readVolatile(config.briefRamp, DEFAULT_CONFIG.briefRamp)),
    toolRamp: parseNumberList(readVolatile(config.toolRamp, DEFAULT_CONFIG.toolRamp)),
    compressDiscount: readVolatile(config.compressDiscount, DEFAULT_CONFIG.compressDiscount),
    warmUpSteps: readVolatile(config.warmUpSteps, DEFAULT_CONFIG.warmUpSteps),
    trivialLiftCap: readVolatile(config.trivialLiftCap, DEFAULT_CONFIG.trivialLiftCap),
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
            .filter((id) => typeof id === 'string' && id !== 'off' && id !== 'none' && id !== 'auto')
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

/**
 * Apply the auto path's safety postcondition after the generic nearest-level
 * mapping. The public mapEffort must keep its "nearest, ties stronger" meaning;
 * the SCHEDULER additionally guarantees:
 *   - a normal Auto schedule never emits a non-thinking effort (`off`/`none`);
 *   - a poisoned history pin is applied only when the target really advertises
 *     `off`. Otherwise the field is stripped and the downgrade is reported,
 *     never disguised as a successful pin.
 * @returns {{ effort: string|undefined, mode: string, warning: string|null }}
 */
function scheduledEffortFor(decision, advertised, cfg = POLICY_DEFAULTS) {
  const levels = Array.isArray(advertised) ? advertised : []
  if (decision && decision.poisoned) {
    if (levels.includes('off')) return { effort: 'off', mode: 'poisoned', mapping: 'off', warning: null }
    return {
      effort: undefined,
      mode: 'poisoned-unsupported',
      mapping: 'unsupported',
      warning: 'target model does not advertise off; cannot preserve off for poisoned history',
    }
  }
  const thinking = levels.filter((id) => typeof id === 'string' && id !== 'off' && id !== 'none' && id !== 'auto')
  const selected = effortForRank(decision ? decision.targetRank : 0, thinking, {
    allowedRanks: cfg.allowedRanks,
    fallback: cfg.effortFallback,
  })
  const unknownNote = selected.unknown.length > 0
    ? 'unknown selector id(s) ' + selected.unknown.join(', ') + ' normalized by advertised order'
    : null
  if (selected.effort === undefined) {
    return {
      effort: undefined,
      mode: 'unsupported',
      mapping: selected.mapping,
      warning: cfg.allowedRanks
        ? 'no advertised level intersects allowedEfforts; effort stripped'
        : 'model advertises no non-off reasoning level; effort stripped',
    }
  }
  return {
    effort: selected.effort,
    mode: 'auto',
    mapping: selected.mapping,
    warning: unknownNote,
  }
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
    if (liveCache.key !== key) {
      const value = normalizePolicyConfig(snapshot)
      liveCache = { key, value }
      if (value.routeError) logger.warn('[effort-router] routes rejected: ' + value.routeError)
      if (value.configConflict) logger.warn('[effort-router] config conflict: ' + value.configConflict)
      if (value.allowedError) logger.warn('[effort-router] allowedEfforts: ' + value.allowedError)
    }
    return liveCache.value
  }

  // ---- capability layer ----------------------------------------------------
  const capability = createCapabilityResolver({ llm: () => service('llm') })
  /** Wrappers installed across adapter churn; teardown restores every one. */
  const autoMaskRegistrations = []
  const warnedScheduling = new Set()
  let disposed = false
  const readvertise = () => {
    if (disposed) return
    capability.clear()
    // Adapter churn can replace or remove registrations. Release every wrapper
    // this plugin installed previously before re-wrapping the current set, so a
    // removed adapter is not held alive until plugin unload.
    for (let i = autoMaskRegistrations.length - 1; i >= 0; i -= 1) {
      try { autoMaskRegistrations[i].dispose() } catch (_maskCleanup) { /* best-effort */ }
    }
    autoMaskRegistrations.length = 0
    const registration = advertiseAutoMask(service('llm'), logger)
    if (registration.count > 0) autoMaskRegistrations.push(registration)
  }
  readvertise()

  // ---- custom-model effort fill-in -----------------------------------------
  // Read the live llm-pi-ai section → candidates = BASE-layer rows without a
  // reasoningEfforts table (user-owned rows are diagnosed, never written) →
  // RESOLUTION GATE: keep only models whose resolved info advertises no
  // thinking levels (a catalog model inheriting levels is never shadowed) →
  // pure fill transform (identity when nothing is missing)
  // → whole-field update, so dsh's llm-pi-ai schema validator gates the write
  // where it is written. Writes are queued; a rejection, a settings conflict,
  // or a failed resolution is logged and retried on the next trigger, never
  // fatal.
  //
  // The settings seam is @deepseek-ai/dsh-settings: describe() projects every
  // entry's VOLATILE fields (llm-pi-ai's `providers` is volatile) with a
  // revision, update(ns, patch, expectedRevision) merges and persists through
  // the config editor. There is NO get(ns) — a guard that waits for one
  // silently disables the whole fill (the 0.1.0–0.1.2 bug). 0.2.1 adds the
  // BASE layer to the descriptor (profile/bundle config) next to `user`
  // (settings-document edits): candidates come from the base, and a row the
  // user layer already owns is never touched — the Models page's
  // reasoning-effort switch stores OFF by REMOVING the field, so re-filling
  // such a row would silently undo the user's choice.
  let syncTail = Promise.resolve()
  const warnedFillHoles = new Set()
  const syncCustomModels = () => {
    syncTail = syncTail.then(async () => {
      if (disposed) return
      if (!current().fillCustomModels) return
      const settings = service('settings')
      if (!settings || typeof settings.describe !== 'function' || typeof settings.update !== 'function') {
        logger.warn('[effort-router] settings service exposes no describe/update; custom-model fill is unavailable on this host')
        return
      }
      const descriptor = settings.describe().find((row) => row && row.ns === PI_AI_NAMESPACE)
      if (!descriptor) return
      const userSection = descriptor.user && typeof descriptor.user === 'object' ? descriptor.user : {}
      // 0.2.0 hosts expose only value/user; 0.2.1 adds the untouched base layer.
      const baseSection = descriptor.base && typeof descriptor.base === 'object'
        ? descriptor.base
        : descriptor.value
      if (!baseSection || typeof baseSection !== 'object') return
      const baseCandidates = fillCandidates(baseSection)
      const baseKeys = new Set(baseCandidates)
      const effectiveSection = descriptor.value && typeof descriptor.value === 'object'
        ? descriptor.value
        : userSection
      const candidates = baseCandidates.filter((key) => !userOwnsModel(userSection, key))
      const llm = service('llm')

      // Diagnostics only — never a write. A hand-declared model in the
      // profile/user layer is deliberately outside the fill's ownership (the
      // Models page stores "off" by removing the table), but staying silent
      // about a model that resolves with no levels hid the K3.1-Pro gap. Name
      // each such row once so the user can declare a table (or accept off).
      const userOnly = fillCandidates(effectiveSection).filter((key) => !baseKeys.has(key))
      for (const key of userOnly) {
        if (warnedFillHoles.has(key)) continue
        const slash = key.indexOf('/')
        try {
          const info = llm && typeof llm.resolveModelInfo === 'function'
            ? await llm.resolveModelInfo(key.slice(0, slash), key.slice(slash + 1))
            : undefined
          if (disposed) return
          const levels = info && info.reasoning && Array.isArray(info.reasoning.efforts)
            ? info.reasoning.efforts
                .map((effort) => effort && effort.id)
                .filter((id) => typeof id === 'string' && id !== 'off' && id !== 'none' && id !== 'auto')
            : []
          if (levels.length === 0) {
            warnedFillHoles.add(key)
            logger.warn('[effort-router] custom model ' + key + ' has no reasoning levels; '
              + 'it stays user-owned (declare reasoningEfforts explicitly to enable Auto)')
          }
        } catch (error) {
          logger.warn('[effort-router] custom model ' + key + ' capability check failed: '
            + String((error && error.message) || error))
        }
      }

      if (candidates.length === 0) return
      const targets = await resolveFillTargets(llm, candidates, logger)
      if (disposed || targets.length === 0) return
      const { providers, filled } = planFill(baseSection, userSection, targets)
      if (!providers || filled.length === 0) return
      if (disposed) return
      await settings.update(PI_AI_NAMESPACE, { providers }, descriptor.revision)
      if (disposed) return
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
    compress: createCompressor(),
    fingerprint: fingerprintArguments,
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

  // One owning effect for every mutation this plugin installs. Restoring the
  // adapters matters beyond hygiene: a disable/remount must not leave Auto in
  // the native selector with no interceptor left to resolve it.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if (disposed) return
      disposed = true
      for (let i = autoMaskRegistrations.length - 1; i >= 0; i -= 1) {
        try { autoMaskRegistrations[i].dispose() } catch (_maskCleanup) { /* best-effort */ }
      }
      autoMaskRegistrations.length = 0
      try { store.dispose() } catch (_storeCleanup) { /* best-effort */ }
    }, 'effort-router: lifecycle')
  }

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
   * Selection-echo handling, by PROVENANCE rather than pattern. Confirmed
   * host semantics (app.asar, dsh-api-session-controller): the in-memory
   * request selection follows the LAST STAMPED request header
   * (`selectionFor().current` reads `session.requestHeader()` when no
   * durable pick is cached), while the `modelSelection` projection holds
   * the DURABLE intent in `pending` (wire: `next = pending ?? lastUsed`;
   * a stamped header only retires `pending` when it MATCHES it). So a
   * scheduled 'auto' — resolved to a concrete level before stamping —
   * echoes back on the next step as a concrete seed that LOOKS like a
   * manual pick, while the durable intent stays whatever it was.
   *
   * The 0.2.x phantom-manual bug (fixed 0.2.8): the echo guard read ANY
   * non-null pending as "a durable human pick" — including OUR OWN
   * markAutoPending 'auto' stamp — so from step 2 onward every echo was
   * recorded manual, and each manual stamp fed the next mirror (103
   * locked sessions in the field log). The guard now distinguishes THREE
   * pending states:
   *
   *   1. pending carries a CONCRETE effort → a real pick; never an echo.
   *   2. pending carries 'auto' → durable AUTO intent (a UI Auto pick, or
   *      our stamp). A concrete seed on the same route is then
   *      DEFINITIONALLY the header mirror: echo, unconditionally. This is
   *      also what un-breaks sessions locked by the old bug (their
   *      pending persisted 'auto').
   *   3. pending null → echo iff OUR decision store proves the last
   *      decision was our auto schedule of the same effort on the same
   *      route (an explicit pick records mode 'manual', so
   *      consumed-then-cleared picks are never misjudged).
   *
   * markAutoPending keeps the selector honest after we schedule (append
   * model/selection 'auto' when nothing is pending), skipped for subagent
   * sessions and idempotent by the pending check.
   */
  const pendingOf = (agent) => {
    try {
      const projections = service('sessionProjections')
      if (!projections || typeof projections.stateOf !== 'function' || !agent || !agent.session) {
        return { unreadable: true }
      }
      const state = projections.stateOf(agent.session, 'modelSelection')
      if (!state) return { unreadable: true }
      return { pending: state.pending ?? null }
    } catch (_unreadable) {
      return { unreadable: true } // unknown is never treated as "no pick" (safe direction)
    }
  }

  const isSelectionEcho = (agent, seed, seedEffort) => {
    const { pending, unreadable } = pendingOf(agent)
    if (unreadable) return false
    if (pending) {
      if (pending.reasoningEffort === 'auto') {
        // Durable AUTO intent on this route: a concrete seed is the mirror.
        return pending.provider === seed.provider && pending.model === seed.model
      }
      return false // a durable concrete pick: never an echo
    }
    const last = store.last(sessionIdOf(agent))
    return !!last
      && last.mode === 'auto'
      && last.effort === seedEffort
      && last.provider === seed.provider
      && last.model === seed.model
  }

  /**
   * Delegation inheritance, by HOST PROVENANCE (0.2.15, ROADMAP R5).
   *
   * A subagent request arrives carrying a CONCRETE effort, and until now that
   * was indistinguishable from a human pick, so every child inherited its
   * parent's level verbatim and the subagent knobs were inert. The host itself
   * explains where that level comes from (dsh-subagent/lib/types/child-agent.js,
   * verified against 0.2.1-rc.2):
   *
   *   - `parentAgentOptionsForDelegation` gives the child "the parent's latest
   *     request header — provider, model and reasoningEffort" (the header WE
   *     stamped with a scheduled level), so the inherited effort is either the
   *     level a human pinned in the parent, or the level we scheduled there;
   *   - `childSessionMeta` persists `parentSession`, `origin: "subagent"` and
   *     `delegationDepth` on the child's session header — a durable lineage
   *     marker, verified on a live child log.
   *
   * So the child's seed can be classified from OUR OWN decision log: if the
   * parent's last decision was mode `auto` (a schedule) or `subagent` (this
   * rule's own output) and it matches the seed's level and route, the seed is
   * our inheritance and the child is scheduled from its own brief. Anything
   * else — a manual pick, a pinned default, a mismatch, or no parent record at
   * all — is left alone: "parent manual => child manual" is the requirement
   * that matters more than "parent auto => child auto".
   */
  const parentSessionOf = (agent) => {
    const header = agent && agent.session && agent.session.header
    if (!header || typeof header !== 'object') return null
    const depth = Number(header.delegationDepth)
    if (!Number.isFinite(depth) || depth <= 0) return null
    // The durable lineage field the host writes; `parentAgent` is the live
    // in-process fallback for hosts that do not persist the header field.
    if (typeof header.parentSession === 'string' && header.parentSession) return header.parentSession
    const parent = agent.parentAgent
    const id = parent && (parent.sessionId || (parent.session && parent.session.id))
    return typeof id === 'string' && id ? id : null
  }

  const isDelegationEcho = (agent, seed, seedEffort) => {
    // `off` is a lineage safety pin on strict thinking-mode APIs: never
    // re-enable thinking in a child seeded from a poisoned parent.
    if (seedEffort === 'off') return false
    const parentId = parentSessionOf(agent)
    if (!parentId) return false
    const recent = store.recent(parentId)
    if (recent.length === 0) return false
    // The parent must be on OUR schedule RIGHT NOW: a durable manual pick or a
    // pinned default records those modes and stops the child from being routed.
    const newest = recent[recent.length - 1]
    if (newest.mode !== 'auto' && newest.mode !== 'subagent') return false
    // 0.2.1 delegation is NON-BLOCKING: the parent stamps its next step — with a
    // possibly different level — before the child's first request arrives
    // (measured live: parent auto/high then auto/max, child seed high). So accept
    // any recent scheduled level on the same route, not only the newest one.
    return recent.some((decision) => (decision.mode === 'auto' || decision.mode === 'subagent')
      && decision.effort === seedEffort
      && decision.provider === seed.provider
      && decision.model === seed.model)
  }

  const markAutoPending = (agent, seed) => {
    try {
      const session = agent && agent.session
      const header = session && session.header
      if (!session || typeof session.append !== 'function') return
      if (header && Number.isFinite(header.delegationDepth) && header.delegationDepth > 0) return
      const { pending, unreadable } = pendingOf(agent)
      // Anything pending — our 'auto' stamp (idempotence) or a durable
      // pick that is not ours to touch — means nothing to do.
      if (unreadable || pending !== null) return
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
  const storeProvenManualOff = (sessionId) => store.hadManualOff(sessionId)

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
        return stripAutoEffort(seed)
      }
      const agent = payload && payload.agent
      if (!agent) return seed
      rememberSession(agent)

      const cap = await capability.resolve(seed.provider, seed.model)
      const seedEffort = typeof seed.reasoningEffort === 'string' ? seed.reasoningEffort : undefined
      let selectionEcho = false
      let delegationEcho = false

      // Manual pick: a concrete, non-auto level is an explicit user (or
      // orchestrator) choice. Pass it through verbatim when the model
      // advertises it; strip it otherwise — an unadvertised level would be
      // rejected per request, and we never clamp an explicit choice.
      if (seedEffort !== undefined && seedEffort !== 'auto') {
        if (!cap.supportsReasoning || !cap.efforts.includes(seedEffort)) {
          const stripped = { ...seed }
          delete stripped.reasoningEffort
          record(agent, payload, {
            mode: 'manual-stripped', effort: null, tier: null, stepClass: null,
            reason: 'model does not advertise "' + seedEffort + '"; stripped',
          }, seed)
          return stripped
        }
        if (isSelectionEcho(agent, seed, seedEffort)) {
          // Our own scheduled value echoed back through lastUsed: not a pick.
          selectionEcho = true
        } else if (isDelegationEcho(agent, seed, seedEffort)) {
          // A subagent inheriting OUR schedule from its parent (R5): the child
          // is scheduled from its own brief, the parent's level is not a pick.
          delegationEcho = true
        } else {
          record(agent, payload, {
            mode: 'manual', effort: seedEffort, tier: null, stepClass: null, reason: '',
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
          mode: 'unsupported', effort: null, tier: null, stepClass: null,
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
          stepClass: null, reason: 'pinned default level',
        }, seed)
        return out
      }

      // Subagent default: only fills requests with no explicit effort.
      const sig = signals.collect(agent, payload, cfg)
      if (sig.delegationDepth > 0 && cfg.subagentEffort !== 'inherit') {
        const effort = mapEffort(cfg.subagentEffort, cap.efforts)
        const out = { ...seed }
        if (effort === undefined) delete out.reasoningEffort
        else out.reasoningEffort = effort
        record(agent, payload, {
          mode: 'subagent', effort: effort ?? null, tier: cfg.subagentEffort,
          stepClass: null, reason: 'subagent default (depth ' + sig.delegationDepth + ')',
        }, seed)
        return out
      }

      // Scheduled path (0.2.8 drift): origin anchor + stacked channels →
      // route → clamp → never-off. Poison pin: shape suspect AND store proof
      // (see storeProvenManualOff); shape alone is never enough. No
      // hysteresis anywhere — the short window decays the evidence itself.
      // The shape is the lifetime of the proof. Once compaction or a branch
      // switch removes it, old manual-off evidence must not arm a later,
      // unrelated reasoning-less tool call (a common K3 shape with thinking on).
      if (sig.offShapeHistory !== true) store.clearManualOff(sessionIdOf(agent))
      sig.poisonedHistory = cfg.poisonRecovery === true
        && sig.offShapeHistory === true
        && storeProvenManualOff(sessionIdOf(agent))
      const decision = decideEffort(cfg, sig)
      const reason = [...decision.reason]
      if (delegationEcho) {
        reason.push('subagent inherited the parent\'s scheduled level; scheduled from its own brief')
      } else if (selectionEcho) {
        reason.push('selection echo of a scheduled header (no durable pick); rescheduled')
      }
      const scheduled = scheduledEffortFor(decision, cap.efforts, cfg)
      const effort = scheduled.effort
      const warnKey = String(seed.provider) + '/' + String(seed.model) + '|' + scheduled.mode
      if (scheduled.warning && !warnedScheduling.has(warnKey)) {
        warnedScheduling.add(warnKey)
        logger.warn('[effort-router] ' + String(seed.provider) + '/' + String(seed.model) + ': ' + scheduled.warning)
      }

      const out = { ...seed }
      if (effort === undefined) {
        delete out.reasoningEffort
        if (scheduled.warning) reason.push(scheduled.warning)
      } else {
        out.reasoningEffort = effort
      }
      record(agent, payload, {
        mode: scheduled.mode,
        effort: effort ?? null,
        tier: decision.tier,
        targetTier: decision.targetTier,
        targetRank: decision.targetRank,
        mapping: scheduled.mapping,
        stepClass: decision.stepClass,
        reason: reason.join('; '),
        // Observation fields: the next audit cycle re-calibrates the volume
        // ramps and the escalateOnErrors flip rate from these actuals. None
        // of them feeds back into decisions beyond what decideEffort read.
        originClass: decision.baseClass,
        warmup: sig.warmup === true,
        briefTokens: sig.briefTokens,
        briefEffective: sig.briefEffective,
        briefVolume: sig.briefVolume,
        briefVolumeRaw: sig.briefVolumeRaw,
        toolVolume: sig.toolVolume,
        toolVolumeRaw: sig.toolVolumeRaw,
        windowErrors: sig.taskErrors,
        windowRepeats: sig.taskRepeats,
        weightedErrors: Math.round(sig.weightedErrors * 100) / 100,
        weightedRepeats: Math.round(sig.weightedRepeats * 100) / 100,
        errorSources: sig.errorSources,
        contextPressure: sig.pressure,
        sessionTokens: sig.sessionTokens,
        todoBump: sig.todoBump === 1,
        subagentReturn: sig.subagentReturn === 1,
        compaction: sig.compaction === 1,
        carry: sig.carry,
        consecSameTool: sig.consecSameTool,
        frugal: sig.frugal === true,
        frugalWhy: sig.frugal ? sig.frugalWhy || null : null,
      }, seed)
      // Close the echo channel at the source: with no durable pick, stamp
      // 'auto' as the session's pending selection so the host stops
      // rebuilding the selection from our scheduled header (the selector UI
      // keeps showing Auto too). A durable concrete pick is never touched.
      if (!decision.poisoned) markAutoPending(agent, seed)
      logger.info(
        '[effort-router] ' + (sessionIdOf(agent) || 'session') +
        ' turn ' + (payload && payload.turn) + ' step ' + (payload && payload.step) +
        ' origin ' + decision.baseClass + ' rank ' + decision.targetRank + ' (' + decision.targetTier + ')' +
        ' -> ' + String(seed.provider) + '/' + String(seed.model) +
        ' effort ' + (effort ?? 'default') +
        (reason.length ? ' [' + reason.join(', ') + ']' : ''),
      )
      return out
    } catch (error) {
      logger.warn('[effort-router] interceptor failed; passing the request through: '
        + String((error && error.message) || error))
      // Fail open for concrete picks, but never let our virtual sentinel cross
      // the host boundary unresolved — the same rule as the disabled branch.
      return stripAutoEffort(seed)
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
  // Sessions opened from HISTORY in the Web UI are served through
  // sessionQuery and are NOT attached to the live `sessions` store (0.2.1):
  // their anchors cannot come from the live projection, so the same pure
  // fold runs over the stored event log instead. The cache keeps a successful
  // read for 30 s and a failure for 5 s; concurrent polls for one session
  // share a single in-flight read. A stale read therefore cannot overwrite a
  // newer one, and an unavailable log cannot be retried every 2.5 s.
  const anchorTableOfEvents = (events) => {
    let state = effortAnchorsProjection.init()
    for (const event of events) state = effortAnchorsProjection.apply(state, event)
    return state.anchors
  }
  const STORED_ANCHOR_CACHE = 64
  const STORED_ANCHOR_TTL_MS = 30000
  const STORED_ANCHOR_ERROR_TTL_MS = 5000
  const storedAnchors = new Map()
  const storedInFlight = new Map()
  const rememberStored = (sessionId, result) => {
    storedAnchors.delete(sessionId)
    storedAnchors.set(sessionId, { ...result, at: Date.now() })
    while (storedAnchors.size > STORED_ANCHOR_CACHE) storedAnchors.delete(storedAnchors.keys().next().value)
  }
  const anchorsOfStoredSession = async (sessionId) => {
    const cached = storedAnchors.get(sessionId)
    if (cached) {
      const ttl = cached.error ? STORED_ANCHOR_ERROR_TTL_MS : STORED_ANCHOR_TTL_MS
      if (Date.now() - cached.at <= ttl) {
        // Refresh LRU position: the pane being viewed is the recurrent one.
        storedAnchors.delete(sessionId)
        storedAnchors.set(sessionId, cached)
        return { table: cached.table, error: cached.error }
      }
    }
    const pending = storedInFlight.get(sessionId)
    if (pending !== undefined) return pending
    const promise = (async () => {
      let table = null
      let error = null
      try {
        const query = service('sessionQuery')
        if (!query) {
          error = 'sessionQuery service unavailable'
          return { table, error }
        }
        // The public read APIs on 0.2.1: readSession() reads and replay-validates
        // one complete log WITHOUT making the session live (no write lease —
        // exactly the read-only contract this route needs), and observeSession()
        // is the lease-based observation the API controller itself uses.
        let events
        if (typeof query.readSession === 'function') {
          const loaded = await query.readSession(sessionId)
          events = loaded && Array.isArray(loaded.events) ? loaded.events : []
        } else if (typeof query.observeSession === 'function') {
          const observation = await query.observeSession(sessionId)
          try {
            events = observation && Array.isArray(observation.events) ? observation.events : []
          } finally {
            if (observation && typeof observation[Symbol.dispose] === 'function') observation[Symbol.dispose]()
            else if (observation && typeof observation.close === 'function') observation.close()
          }
        } else {
          error = 'sessionQuery exposes neither readSession nor observeSession'
          return { table, error }
        }
        if (events.length === 0) {
          error = 'sessionQuery returned no events'
          return { table, error }
        }
        const folded = anchorTableOfEvents(events)
        table = Object.keys(folded).length > 0 ? folded : null
        return { table, error }
      } catch (readError) {
        error = ((readError && readError.name) || 'Error') + ': ' + ((readError && readError.message) || readError)
        return { table: null, error }
      }
    })()
    storedInFlight.set(sessionId, promise)
    try {
      const result = await promise
      rememberStored(sessionId, result)
      return result
    } finally {
      if (storedInFlight.get(sessionId) === promise) storedInFlight.delete(sessionId)
    }
  }
  // Merged fallback (the shell URL does not always expose the session id to
  // DOM-level plugins): assistant anchor keys are per-session coordinates and
  // collide across sessions, so the client sends one visible tool call id as
  // `hint` — call ids are unique and identify the on-screen session's table
  // exactly. Without identity the merge is AMBIGUITY-SAFE (0.2.11): a key
  // whose value differs across the candidate tables is dropped rather than
  // attributed to whichever session came last. Session sources, in order: the
  // live `sessions` store, then our hook-fed sessionRefs supplement; a known
  // id that is neither live nor hook-fed resolves through sessionQuery's
  // persisted log (0.2.12).
  const ANCHOR_MERGE_SESSIONS = 8
  const cachedAnchorsOfSession = (session, projections) => {
    if (typeof projections.cachedSnapshot !== 'function') return null
    try {
      const snapshot = projections.cachedSnapshot(session, [EFFORT_ANCHORS_KEY])
      const view = snapshot && snapshot.values ? snapshot.values[EFFORT_ANCHORS_KEY] : undefined
      return view && view.anchors ? view.anchors : null
    } catch (_unreadable) {
      return null
    }
  }
  const anchorsOf = async (sessionId, hint) => {
    try {
      const projections = service('sessionProjections')
      const canProject = !!projections && typeof projections.stateOf === 'function'
      // NOT `store`: that name is the decision store in this closure, and the
      // shadowing worked only by accident.
      const sessionStore = service('sessions')
      if (sessionId) {
        const direct = (sessionStore && typeof sessionStore.get === 'function' ? sessionStore.get(sessionId) : undefined) ?? sessionRefs.get(sessionId)
        if (direct && canProject) {
          const anchors = anchorsOfSession(direct, projections)
          if (anchors && Object.keys(anchors).length > 0) return { table: anchors, resolved: 'session', error: null }
        }
        // Not live (0.2.1 history view) — fold the stored log instead. A KNOWN
        // id this runtime cannot read must NEVER fall through to the merged
        // table: assistant anchor keys are per-session coordinates, so the
        // merge would paint a neighbouring session's capsule. Missing
        // captions are honest; wrong ones are not.
        const stored = await anchorsOfStoredSession(sessionId)
        return stored.table
          ? { table: stored.table, resolved: 'stored', error: null }
          : { table: null, resolved: null, error: stored.error }
      }
      if (!canProject) return { table: null, resolved: null, error: 'sessionProjections service unavailable' }
      // Order and dedupe WITHOUT touching projections: stateOf() may replay a
      // session's event log, so materializing every listed session before the
      // cap starved the host on busy profiles (0.2.7-rc.1 regression). Cap to
      // the most recently active sessions first, then fold only those.
      const byId = new Map()
      const consider = (session) => {
        const id = session && session.id ? String(session.id) : ''
        if (!id) return
        if (byId.has(id)) byId.delete(id) // re-insert: newest activity sorts last
        byId.set(id, session)
      }
      if (sessionStore && typeof sessionStore.list === 'function') {
        try { for (const session of sessionStore.list()) consider(session) } catch (_list) { /* best-effort */ }
      }
      for (const session of sessionRefs.values()) consider(session)
      const ordered = [...byId.values()]
      const capped = ordered.slice(-ANCHOR_MERGE_SESSIONS)
      const candidates = []
      for (const session of capped) {
        const anchors = anchorsOfSession(session, projections)
        if (anchors) candidates.push({ id: String(session.id), anchors })
      }
      if (hint) {
        // The on-screen ledger may be idle while newer sessions occupy the
        // merge slice. Look in the materialized slice first, then in cached
        // projections of older sessions — never in a full stateOf sweep.
        for (let i = candidates.length - 1; i >= 0; i -= 1) {
          if (Object.hasOwn(candidates[i].anchors, hint)) {
            return { table: candidates[i].anchors, resolved: 'hint', error: null }
          }
        }
        for (let i = ordered.length - capped.length - 1; i >= 0; i -= 1) {
          const anchors = cachedAnchorsOfSession(ordered[i], projections)
          if (anchors && Object.hasOwn(anchors, hint)) {
            return { table: anchors, resolved: 'hint', error: null }
          }
        }
      }
      const merged = resolveMergedAnchors(candidates, hint)
      return merged
        ? { table: merged.table, resolved: merged.resolved, error: null }
        : { table: null, resolved: null, error: null }
    } catch (_unreadable) {
      return { table: null, resolved: null, error: 'anchor projection unreadable' }
    }
  }
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') || undefined
          const hint = url.searchParams.get('hint') || undefined
          const requestedView = url.searchParams.get('view') || 'full'
          // `full` is the compatibility default for external readers. The two
          // built-in pollers ask only for what they render: Badge needs the
          // decision, trajectory needs anchors, the one-shot chat flag needs
          // neither. A Badge poll must never pay a stored-log read.
          const view = ['full', 'badge', 'anchors', 'config'].includes(requestedView) ? requestedView : 'full'
          const wantAnchors = view !== 'badge' && view !== 'config'
          const wantDecisions = view === 'full' || view === 'badge'
          const cfg = current()
          const anchors = wantAnchors ? await anchorsOf(sessionId, hint) : null
          const body = {
            ok: true,
            enabled: cfg.enabled,
            defaultLevel: cfg.defaultLevel,
            allowedEfforts: cfg.allowedEfforts,
            effortFallback: cfg.effortFallback,
            trajectoryAnnotate: cfg.trajectoryAnnotate,
            showBadge: cfg.showBadge,
            chatAnnotate: cfg.chatAnnotate,
          }
          if (wantDecisions) body.last = store.last(sessionId) ?? null
          // Only the compatibility `full` view carries the 20-decision ring;
          // the Badge renders `last` alone.
          if (view === 'full') body.recent = store.recent(sessionId)
          body.anchors = anchors ? anchors.table : null
          body.anchorsResolved = anchors ? anchors.resolved : null
          // Per-request diagnosis only; never a cross-session global slot.
          body.anchorsError = anchors ? anchors.error : null
          sendJson(res, 200, body)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      }
      // Effective cue dictionaries, for agents/users editing dictStrong & co:
      // read `effective` (what scheduling actually matches), diff against
      // `builtin`, write the result back as a full-replacement dict* key.
      const dictionariesHandler = async (req, res) => {
        try {
          const cfg = current()
          const snapshot = liveSnapshot(config)
          const lists = {}
          for (const listName of ['strong', 'normal', 'cheap', 'wish']) {
            lists[listName] = {
              effective: cfg[listName],
              builtin: POLICY_DEFAULTS[listName],
              override: snapshot.dictionaries[listName] ?? null,
              additions: snapshot.extraCues[listName],
            }
          }
          sendJson(res, 200, { ok: true, dictionaries: lists })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      }
      const disposers = [
        scope.webServer.register({ kind: 'exact', path: '/effort-router/state', handler }),
        scope.webServer.register({ kind: 'exact', path: '/effort-router/dictionaries', handler: dictionariesHandler }),
      ]
      return () => { for (const dispose of disposers) if (typeof dispose === 'function') dispose() }
    }, 'effort-router: state + dictionaries routes')
  })

  // ---- per-step effort anchors (native trajectory decoration) ----------------
  ctx.inject(['sessionProjections'], (scope) => {
    scope.effect(
      () => scope.sessionProjections.register(effortAnchorsProjection),
      'effort-router: anchors projection',
    )
  })
}
