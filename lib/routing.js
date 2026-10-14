/**
 * dsh-effort-router — tier mapping & projection readers (pure, import-free).
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/routing.js (MIT,
 * Copyright Neptune810), reduced to the effort-only vocabulary: no model pool,
 * no presets, no cross-provider policy.
 *
 * Vocabulary
 *   - internal tier: low | high | max — the scheduler's ladder (policy.js).
 *   - a target model may advertise a different vocabulary; mapEffort()
 *     translates a tier to the nearest advertised level.
 *
 * 0.2.8 retired two residents: stabilize() (hysteresis — with the 6-step
 * short window the evidence itself decays fast enough) and activeTodoText()
 * (todo text as classification evidence — a todo list is only a
 * rearrangement of the origin brief, not independent evidence).
 */

/** Known adapter effort identifiers, ranked weakest to strongest. */
export const EFFORT_RANK = Object.freeze({
  off: 0,
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
  ultra: 7,
})

/** Rank of one effort id; unknown ids read as high (the safe middle). */
export function rankOf(effort) {
  return EFFORT_RANK[effort] !== undefined ? EFFORT_RANK[effort] : EFFORT_RANK.high
}

/**
 * Translate an internal tier onto a target model's own advertised vocabulary.
 * Exact id wins; otherwise the nearest rank, ties resolving to the STRONGER
 * level (a low schedule on an off/high toggle model becomes high, never off).
 * @returns the concrete effort id, or undefined when the model exposes none.
 */
export function mapEffort(tier, supported) {
  if (!Array.isArray(supported) || supported.length === 0) return undefined
  if (supported.includes(tier)) return tier
  const want = rankOf(tier)
  let best
  let bestDistance = Infinity
  for (const id of supported) {
    if (typeof id !== 'string') continue
    const rank = rankOf(id)
    const distance = Math.abs(rank - want)
    if (distance < bestDistance || (distance === bestDistance && want < rank)) {
      best = id
      bestDistance = distance
    }
  }
  return best
}

/** Context occupancy ratio (0-1), or null when the projection has no denominator. */
export function contextPressureRatio(state) {
  if (!state || typeof state !== 'object') return null
  const window = state.contextWindow
  const used = state.pressureTokens !== undefined ? state.pressureTokens : state.surfaceTokens
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(used)) return null
  return used / window
}

/** Session token total from the core `tokenUsage` projection. */
export function sessionTokensOf(state) {
  const totals = state && state.totals
  if (!totals || typeof totals !== 'object') return 0
  let sum = 0
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
    if (Number.isFinite(totals[key])) sum += totals[key]
  }
  return sum
}
