/**
 * dsh-effort-router — custom llm-pi-ai model effort defaults (pure transforms).
 *
 * The idea comes from @hytime/dsh-thinking-effort (MIT, Copyright hytime):
 * hand-declared llm-pi-ai models often ship no `reasoningEfforts` table, so the
 * composer shows no effort selector at all and gateway-specific vocabularies
 * (e.g. `ultra`) cannot be reached. Filling a default table into the user
 * layer fixes the capability at the SOURCE: the pi-ai adapter advertises the
 * levels, the native selector offers them, and request validation accepts
 * them. DSH 0.2's pi-ai adapter reads the table natively — each key is a
 * selectable level, its value the exact spelling sent on the wire (so
 * `high → ultra` renaming needs no plugin-side mapping).
 *
 * Fill rules (precise, resolution-gated):
 *   - Candidates are the rows the user layer declares: `models[]` entries and
 *     `modelOverrides` values whose `reasoningEfforts` is ABSENT. An explicit
 *     table or an explicit `false` (non-reasoning declaration) is user intent
 *     and is never touched.
 *   - The host resolves each candidate through the live adapter
 *     (`resolveModelInfo`, local — no network) and only fills models whose
 *     resolved info advertises NO thinking levels. A catalog model that
 *     already inherits a table from its catalog resolves WITH levels and is
 *     skipped, so the fill can never shadow catalog capability.
 *   - The transform is immutable and identity-stable: an empty target set
 *     means the same section reference comes back, so the host skips the write.
 *
 * The default table spells off as the empty value — pi-ai omits the parameter
 * for it, matching gateway "no reasoning" semantics.
 */

/** The settings namespace holding the provider/model configs. */
export const PI_AI_NAMESPACE = 'llm-pi-ai'

/** Hosts that are NOT custom gateways (official OpenAI-compatible endpoints). */
const OFFICIAL_HOST_RE = /(?:^|\.)(?:deepseek\.com|openai\.com|openrouter\.ai|anthropic\.com|googleapis\.com|ai\.google\.dev|mistral\.ai|x\.ai)$/i

/**
 * The shipped default table. WIRE-VALUE RULES come from the pi-ai adapter's
 * own validator (dsh-llm-pi-ai resolveModelReasoning):
 *   - `off` MAY be null (parameter omitted on the wire); an empty STRING is
 *     rejected ("must not be an empty string"), and null on any other level is
 *     rejected too;
 *   - at least one non-off level is required;
 *   - keys are limited to off/minimal/low/medium/high/xhigh/max.
 * The native Models page writes exactly `{ off: null, … }` — we mirror it.
 */
export const DEFAULT_EFFORT_TABLE = Object.freeze({ off: null, high: 'high', max: 'max' })

/**
 * Validate a table the way pi-ai will, so a bad one never reaches the schema
 * gate (the gate's rejection is logged by the host without context; ours names
 * the problem). Returns an array of problems; empty = valid.
 */
export function validateEffortTable(table) {
  const problems = []
  if (!table || typeof table !== 'object' || Array.isArray(table)) return ['table must be an object']
  const keys = Object.keys(table)
  if (keys.length === 0) return ['table is empty']
  for (const [level, wire] of Object.entries(table)) {
    if (wire === null || wire === undefined || wire === '') {
      if (level !== 'off') problems.push(level + ': only "off" may omit the wire value')
    } else if (typeof wire !== 'string') {
      problems.push(level + ': wire value must be a string')
    } else if (wire.trim().length === 0) {
      problems.push(level + ': wire value is blank')
    }
  }
  if (!keys.some((level) => level !== 'off')) problems.push('table offers no level beyond "off"')
  return problems
}

/**
 * Normalize one table for a pi-ai write: empty/blank wire values become null
 * for `off` and are dropped for every other level. Returns a fresh object.
 */
export function normalizeEffortTable(levels) {
  const table = {}
  for (const [level, wire] of Object.entries(levels || {})) {
    if (typeof level !== 'string' || level.length === 0) continue
    const value = typeof wire === 'string' ? wire.trim() : ''
    if (value.length > 0) table[level] = value
    else if (level === 'off') table[level] = null
    // a non-off level without a wire value is dropped: pi-ai would reject it
  }
  return table
}

/**
 * Whether a filled/edited row should also gain `compat.supportsReasoningEffort:
 * true`: only on explicit openai-completions routes (the compat gate is
 * per-protocol and unknown fields are rejected), only when the row (and the
 * provider) does not already declare it. Mirrors what the native Models page
 * writes for thinking models on such routes.
 */
export function needsReasoningCompat(profile, row) {
  if (!profile || profile.api !== 'openai-completions') return false
  if (row && row.compat && row.compat.supportsReasoningEffort !== undefined) return false
  if (profile.compat && profile.compat.supportsReasoningEffort !== undefined) return false
  return true
}

/** Whether a provider profile is a custom (hand-declared) gateway route. */
export function isCustomGateway(profile) {
  if (!profile || typeof profile !== 'object') return false
  if (typeof profile.api === 'string' && profile.api.length > 0) return true
  const baseURL = profile.baseURL
  if (typeof baseURL !== 'string' || baseURL.length === 0) return false
  try {
    return !OFFICIAL_HOST_RE.test(new URL(baseURL).hostname)
  } catch {
    return false
  }
}

/**
 * Enumerate the fill candidates of a section: every user-layer model row whose
 * reasoningEfforts is absent, as 'provider/model' keys. Pure scan; the host
 * intersects this with the resolution gate before calling withDefaultEfforts.
 */
export function fillCandidates(section) {
  const out = []
  const providers = section && typeof section === 'object' ? section.providers : undefined
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return out
  for (const [providerId, profile] of Object.entries(providers)) {
    if (!profile || typeof profile !== 'object') continue
    if (Array.isArray(profile.models)) {
      for (const row of profile.models) {
        if (row && typeof row === 'object' && typeof row.id === 'string'
          && row.reasoningEfforts === undefined) {
          out.push(providerId + '/' + row.id)
        }
      }
    }
    const overrides = profile.modelOverrides
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      for (const [modelId, row] of Object.entries(overrides)) {
        if (row && typeof row === 'object' && row.reasoningEfforts === undefined) {
          out.push(providerId + '/' + modelId)
        }
      }
    }
  }
  return out
}

/**
 * Fill absent reasoningEfforts tables for the given target models.
 * Pure: returns { next, filled } — `next` is the SAME section
 * reference when nothing needed filling, and `filled` names what changed for
 * the host log ([provider/model, ...]).
 *
 * @param section  the live llm-pi-ai settings section (read-only input)
 * @param opts.targets  iterable of 'provider/model' keys to fill (required;
 *                      the host computes it through the resolution gate)
 * @param opts.table    the effort table to fill with (defaults to DEFAULT_EFFORT_TABLE)
 */
export function withDefaultEfforts(section, opts) {
  const providers = section && typeof section === 'object' ? section.providers : undefined
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    return { next: section, filled: [] }
  }
  const targets = new Set((opts && opts.targets) || [])
  if (targets.size === 0) return { next: section, filled: [] }
  const table = (opts && opts.table) || DEFAULT_EFFORT_TABLE
  const filled = []
  let nextProviders
  for (const [providerId, profile] of Object.entries(providers)) {
    if (!profile || typeof profile !== 'object') continue
    let nextProfile = profile
    if (Array.isArray(profile.models)) {
      let nextModels
      profile.models.forEach((row, index) => {
        if (typeof row !== 'object' || row === null) return
        if (row.reasoningEfforts !== undefined) return
        const key = providerId + '/' + (typeof row.id === 'string' ? row.id : '#' + index)
        if (!targets.has(key)) return
        if (nextModels === undefined) nextModels = [...profile.models]
        const nextRow = { ...row, reasoningEfforts: { ...table } }
        // openai-completions routes need the compat flag for the effort to be
        // serialized; mirror the native Models page and add it when absent.
        if (needsReasoningCompat(profile, row)) {
          nextRow.compat = { ...(row.compat && typeof row.compat === 'object' ? row.compat : {}), supportsReasoningEffort: true }
        }
        nextModels[index] = nextRow
        filled.push(key)
      })
      if (nextModels !== undefined) nextProfile = { ...nextProfile, models: nextModels }
    }
    const overrides = profile.modelOverrides
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      let nextOverrides
      for (const [modelId, row] of Object.entries(overrides)) {
        if (!row || typeof row !== 'object' || row.reasoningEfforts !== undefined) continue
        const key = providerId + '/' + modelId
        if (!targets.has(key)) continue
        if (nextOverrides === undefined) nextOverrides = { ...overrides }
        const nextRow = { ...row, reasoningEfforts: { ...table } }
        if (needsReasoningCompat(profile, row)) {
          nextRow.compat = { ...(row.compat && typeof row.compat === 'object' ? row.compat : {}), supportsReasoningEffort: true }
        }
        nextOverrides[modelId] = nextRow
        filled.push(key)
      }
      if (nextOverrides !== undefined) nextProfile = { ...nextProfile, modelOverrides: nextOverrides }
    }
    if (nextProfile !== profile) {
      if (nextProviders === undefined) nextProviders = { ...providers }
      nextProviders[providerId] = nextProfile
    }
  }
  if (nextProviders === undefined) return { next: section, filled }
  return { next: { ...section, providers: nextProviders }, filled }
}

/**
 * Edit ONE model's effort table inside the section (settings card writes).
 * Levels maps levelId -> wire value; a level absent from the map is REMOVED
 * from the row's table (the card submits the complete edited table). Wire
 * values are normalized for the pi-ai gate: an empty/blank value becomes null
 * for `off` (parameter omitted on the wire) and drops any other level (pi-ai
 * rejects empty strings). Returns { next, changed, table, problems } — when
 * the normalized table is invalid, changed is false and problems lists why.
 *
 * The row may live in `models[]` (rewritten by index, other rows preserved) or
 * `modelOverrides` (rewritten by key). A missing row is a no-op. On explicit
 * openai-completions routes a table with at least one non-off level also gains
 * `compat.supportsReasoningEffort: true` when neither the row nor the provider
 * declares it (mirrors the native Models page).
 *
 * @param section  the live llm-pi-ai section
 * @param providerId  route id
 * @param modelId     model id inside the route
 * @param levels      complete effort table, e.g. { off: '', high: 'ultra' }
 */
export function withModelEfforts(section, providerId, modelId, levels) {
  const providers = section && typeof section === 'object' ? section.providers : undefined
  if (!providers || typeof providers !== 'object') {
    return { next: section, changed: false, table: {}, problems: ['no providers'] }
  }
  const profile = providers[providerId]
  if (!profile || typeof profile !== 'object') {
    return { next: section, changed: false, table: {}, problems: ['unknown provider ' + providerId] }
  }
  const table = normalizeEffortTable(levels)
  const problems = validateEffortTable(table)
  if (problems.length > 0) return { next: section, changed: false, table, problems }

  const rowCompat = (row) =>
    needsReasoningCompat(profile, row)
      ? { ...(row.compat && typeof row.compat === 'object' ? row.compat : {}), supportsReasoningEffort: true }
      : undefined

  if (Array.isArray(profile.models)) {
    const index = profile.models.findIndex(
      (row) => row && typeof row === 'object' && row.id === modelId,
    )
    if (index < 0) return { next: section, changed: false, table, problems: ['unknown model ' + modelId] }
    const nextModels = [...profile.models]
    const compat = rowCompat(nextModels[index])
    nextModels[index] = {
      ...nextModels[index],
      reasoningEfforts: table,
      ...(compat ? { compat } : {}),
    }
    return {
      next: { ...section, providers: { ...providers, [providerId]: { ...profile, models: nextModels } } },
      changed: true,
      table,
      problems: [],
    }
  }
  const overrides = profile.modelOverrides
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides) && overrides[modelId]) {
    const compat = rowCompat(overrides[modelId])
    const nextOverrides = {
      ...overrides,
      [modelId]: {
        ...overrides[modelId],
        reasoningEfforts: table,
        ...(compat ? { compat } : {}),
      },
    }
    return {
      next: { ...section, providers: { ...providers, [providerId]: { ...profile, modelOverrides: nextOverrides } } },
      changed: true,
      table,
      problems: [],
    }
  }
  return { next: section, changed: false, table, problems: ['unknown model ' + modelId] }
}
