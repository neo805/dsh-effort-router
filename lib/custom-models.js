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
 * Two layers, since DSH 0.2.1 (0.2.10): `settings.describe()` exposes the
 * PROFILE/base layer (bundle config — where hand-declared rows live) next to
 * the settings-document USER layer (Models-page edits). Fill rules:
 *   - CANDIDATES come from the BASE layer: `models[]` entries and
 *     `modelOverrides` values whose `reasoningEfforts` is ABSENT. An explicit
 *     table or an explicit `false` (non-reasoning declaration) is user intent
 *     and is never touched.
 *   - A row the USER layer already owns is skipped whole (`userOwnsModel`):
 *     the Models page stores "off" by REMOVING the field, so re-filling it
 *     would silently undo an explicit choice.
 *   - The host resolves each remaining candidate through the live adapter
 *     (`resolveModelInfo`, local — no network) and only fills models whose
 *     resolved info advertises NO thinking levels. A catalog model that
 *     already inherits a table resolves WITH levels and is skipped, so the
 *     fill can never shadow catalog capability.
 *   - The write is USER-layer `providers` only (`planFill`): the settings
 *     merge replaces arrays whole, so a touched provider's effective models
 *     list is materialized first — a fill never deletes rows it did not aim
 *     at. An empty target set returns `providers: null` so the host skips the
 *     write entirely.
 *
 * The default table spells off as the empty value — pi-ai omits the parameter
 * for it, matching gateway "no reasoning" semantics.
 */

/** The settings namespace holding the provider/model configs. */
export const PI_AI_NAMESPACE = 'llm-pi-ai'

/**
 * Does the settings USER layer own this 'provider/model' row?
 *
 * DSH 0.2.1's Models page edits reasoningEfforts per model in the UI and
 * writes them into the settings-document user layer. Its reasoning SWITCH
 * stores "off" by REMOVING the field, so an absent `reasoningEfforts` in
 * the user layer is an explicit user choice — not the "never configured"
 * state this plugin's fill targets. A model present in the user layer is
 * therefore skipped entirely (its switch owns the decision); only rows
 * that exist solely in the profile/base layer are fill candidates.
 */
export function userOwnsModel(userSection, key) {
  if (!userSection || typeof userSection !== 'object') return false
  const providers = userSection.providers
  if (!providers || typeof providers !== 'object') return false
  const slash = key.indexOf('/')
  if (slash < 0) return false
  const providerId = key.slice(0, slash)
  const modelId = key.slice(slash + 1)
  const profile = providers[providerId]
  if (!profile || typeof profile !== 'object') return false
  if (Array.isArray(profile.models)) {
    for (const row of profile.models) {
      if (row && typeof row === 'object' && row.id === modelId) return true
    }
  }
  const overrides = profile.modelOverrides
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    if (Object.hasOwn(overrides, modelId)) return true
  }
  return false
}

/**
 * Plan the user-layer write that fills `targets` (0.2.1 aware).
 *
 * The candidates come from the PROFILE layer (descriptor.base); the write
 * lands in the USER layer, which MERGES over the base per object and
 * replaces arrays whole. For a touched provider we therefore materialize
 * the effective models list (the user list when it exists, else the base
 * list) before swapping in the filled row, so a fill never deletes rows.
 *
 * @param baseSection profile-layer llm-pi-ai section (read-only)
 * @param userSection settings user-layer section (read-only)
 * @param targets iterable of 'provider/model' keys
 * @param table effort table (defaults to DEFAULT_EFFORT_TABLE)
 * @returns { providers, filled } — providers is the user-layer value to
 *          merge in, or null when nothing changed.
 */
export function planFill(baseSection, userSection, targets, table = DEFAULT_EFFORT_TABLE) {
  const targetSet = new Set(targets || [])
  if (targetSet.size === 0) return { providers: null, filled: [] }
  const baseProviders = baseSection && typeof baseSection === 'object' ? baseSection.providers : undefined
  if (!baseProviders || typeof baseProviders !== 'object') return { providers: null, filled: [] }
  const userProviders = userSection && typeof userSection === 'object' && userSection.providers && typeof userSection.providers === 'object'
    ? userSection.providers
    : {}
  const outProviders = {}
  const filled = []
  const fillRow = (profile, row) => {
    const nextRow = { ...row, reasoningEfforts: { ...table } }
    if (needsReasoningCompat(profile, row)) {
      nextRow.compat = { ...(row.compat && typeof row.compat === 'object' ? row.compat : {}), supportsReasoningEffort: true }
    }
    return nextRow
  }
  for (const [providerId, baseProfile] of Object.entries(baseProviders)) {
    if (!baseProfile || typeof baseProfile !== 'object') continue
    const userProfile = userProviders[providerId] && typeof userProviders[providerId] === 'object'
      ? userProviders[providerId]
      : undefined
    let nextProfile
    // models[] rows
    if (Array.isArray(baseProfile.models)) {
      const hits = baseProfile.models.filter((row) => row && typeof row.id === 'string'
        && targetSet.has(providerId + '/' + row.id))
      if (hits.length > 0) {
        const list = Array.isArray(userProfile && userProfile.models)
          ? userProfile.models.map((row) => (row && typeof row === 'object' ? { ...row } : row))
          : baseProfile.models.map((row) => (row && typeof row === 'object' ? { ...row } : row))
        for (const row of hits) {
          const key = providerId + '/' + row.id
          const index = list.findIndex((existing) => existing && existing.id === row.id)
          if (index >= 0) list[index] = fillRow(baseProfile, list[index])
          else list.push(fillRow(baseProfile, row))
          filled.push(key)
        }
        nextProfile = { ...(nextProfile || {}), models: list }
      }
    }
    // modelOverrides rows
    const baseOverrides = baseProfile.modelOverrides
    if (baseOverrides && typeof baseOverrides === 'object' && !Array.isArray(baseOverrides)) {
      const hits = Object.keys(baseOverrides).filter((modelId) => targetSet.has(providerId + '/' + modelId))
      if (hits.length > 0) {
        const overrides = userProfile && userProfile.modelOverrides && typeof userProfile.modelOverrides === 'object'
          ? { ...userProfile.modelOverrides }
          : { ...baseOverrides }
        for (const modelId of hits) {
          const row = overrides[modelId] && typeof overrides[modelId] === 'object' ? overrides[modelId] : {}
          overrides[modelId] = fillRow(baseProfile, row)
          filled.push(providerId + '/' + modelId)
        }
        nextProfile = { ...(nextProfile || {}), modelOverrides: overrides }
      }
    }
    if (nextProfile !== undefined) outProviders[providerId] = nextProfile
  }
  if (filled.length === 0) return { providers: null, filled: [] }
  return { providers: outProviders, filled }
}

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
 * Enumerate the fill candidates of a section (the BASE layer in production):
 * every model row whose reasoningEfforts is absent, as 'provider/model' keys.
 * Pure scan; the host filters it with userOwnsModel and the resolution gate
 * before calling planFill.
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

