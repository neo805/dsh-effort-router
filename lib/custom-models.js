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

/**
 * The shipped default table (0.2.0): low/high/max with NO off rung. Off is
 * excluded on purpose — an off selection followed by a tool call poisons the
 * conversation for every later thinking-enabled request (the router's rule 4
 * never emits off either, so a filled table should not offer what the policy
 * refuses to use). WIRE-VALUE RULES come from the pi-ai adapter's own
 * validator (dsh-llm-pi-ai resolveModelReasoning):
 *   - at least one non-off level is required;
 *   - null/empty wire values are only tolerated on `off` (not present here);
 *   - keys are limited to off/minimal/low/medium/high/xhigh/max.
 * Users can still add `off: null` back per model by editing the llm-pi-ai
 * config directly (explicit user intent is never overwritten).
 */
export const DEFAULT_EFFORT_TABLE = Object.freeze({ low: 'low', high: 'high', max: 'max' })

/**
 * Whether a filled row should also gain `compat.supportsReasoningEffort:
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
