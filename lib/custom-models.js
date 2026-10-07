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

/** The shipped default table: off omits the parameter; high/max spell natively. */
export const DEFAULT_EFFORT_TABLE = Object.freeze({ off: '', high: 'high', max: 'max' })

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
        nextModels[index] = { ...row, reasoningEfforts: { ...table } }
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
        nextOverrides[modelId] = { ...row, reasoningEfforts: { ...table } }
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
 * from the row's table (the card submits the complete edited table). The off
 * key is kept only when present in the map. Returns { next, changed }.
 *
 * The row may live in `models[]` (rewritten by index, other rows preserved) or
 * `modelOverrides` (rewritten by key). A missing row is a no-op.
 *
 * @param section  the live llm-pi-ai section
 * @param providerId  route id
 * @param modelId     model id inside the route
 * @param levels      complete effort table, e.g. { off: '', high: 'ultra' }
 */
export function withModelEfforts(section, providerId, modelId, levels) {
  const providers = section && typeof section === 'object' ? section.providers : undefined
  if (!providers || typeof providers !== 'object') return { next: section, changed: false }
  const profile = providers[providerId]
  if (!profile || typeof profile !== 'object') return { next: section, changed: false }
  const table = {}
  for (const [level, wire] of Object.entries(levels || {})) {
    if (typeof level === 'string' && level.length > 0) table[level] = typeof wire === 'string' ? wire : ''
  }

  if (Array.isArray(profile.models)) {
    const index = profile.models.findIndex(
      (row) => row && typeof row === 'object' && row.id === modelId,
    )
    if (index < 0) return { next: section, changed: false }
    const nextModels = [...profile.models]
    nextModels[index] = { ...nextModels[index], reasoningEfforts: table }
    return {
      next: { ...section, providers: { ...providers, [providerId]: { ...profile, models: nextModels } } },
      changed: true,
    }
  }
  const overrides = profile.modelOverrides
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides) && overrides[modelId]) {
    const nextOverrides = { ...overrides, [modelId]: { ...overrides[modelId], reasoningEfforts: table } }
    return {
      next: { ...section, providers: { ...providers, [providerId]: { ...profile, modelOverrides: nextOverrides } } },
      changed: true,
    }
  }
  return { next: section, changed: false }
}
