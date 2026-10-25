/**
 * dsh-effort-router — integer effort ranks, capability normalization and the
 * second-layer allow-list quantizer (pure; no host imports).
 *
 * Three namespaces are deliberately distinct (0.2.16):
 *
 *   1. policy: four origin classes -> a target integer rank (lib/policy.js);
 *   2. mapping: target rank -> an advertised selector id, constrained by the
 *      global allow-list (this module);
 *   3. wire: selector id -> the adapter's vendor spelling (adapter-owned).
 *
 * Canonical ranks: 0 off/none, 1 minimal, 2 low, 3 medium, 4 high, 5 xhigh,
 * 6 max, 7 the extension slot. Normal Auto uses 1..7. Unknown advertised ids
 * are ordered from the adapter's weakest-to-strongest effort list instead of
 * being treated as `high`.
 */
import { EFFORT_RANK, rankOf, tierForRank } from './policy.js'

export { EFFORT_RANK, rankOf }

/**
 * Normalize an advertised effort-id list into integer/fractional ranks.
 * Unknown ids are interpolated from their neighbours in the advertised order;
 * when no id is known, the list spans ranks 1..7 (a lone id is the safe middle
 * rank 4). `auto` is the plugin's sentinel and is never a capability.
 *
 * @returns {{ items: Array<{id: string, rank: number}>, unknown: string[] }}
 */
export function normalizeEfforts(supported) {
  if (!Array.isArray(supported)) return { items: [], unknown: [] }
  const ids = []
  for (const id of supported) {
    if (typeof id === 'string' && id !== 'auto' && !ids.includes(id)) ids.push(id)
  }
  const known = ids.map((id) => (Object.hasOwn(EFFORT_RANK, id) ? EFFORT_RANK[id] : null))
  const unknown = ids.filter((_id, index) => known[index] === null)
  const items = []
  if (ids.length === 0) return { items, unknown }

  const knownIndexes = []
  for (let i = 0; i < ids.length; i += 1) {
    if (known[i] !== null) knownIndexes.push(i)
  }

  if (knownIndexes.length === 0) {
    for (let i = 0; i < ids.length; i += 1) {
      const rank = ids.length === 1 ? 4 : Math.round(1 + (6 * i) / (ids.length - 1))
      items.push({ id: ids[i], rank })
    }
    return { items, unknown }
  }

  for (let i = 0; i < ids.length; i += 1) {
    if (known[i] !== null) {
      items.push({ id: ids[i], rank: known[i] })
      continue
    }
    let previous = -1
    for (let j = i - 1; j >= 0; j -= 1) {
      if (known[j] !== null) { previous = j; break }
    }
    let next = -1
    for (let j = i + 1; j < ids.length; j += 1) {
      if (known[j] !== null) { next = j; break }
    }
    let rank
    if (previous >= 0 && next >= 0) {
      rank = known[previous]
        + ((known[next] - known[previous]) * (i - previous)) / (next - previous)
    } else if (next >= 0) {
      rank = Math.max(1, known[next] - (next - i))
    } else {
      rank = Math.min(7, known[previous] + (i - previous))
    }
    items.push({ id: ids[i], rank })
  }
  return { items, unknown }
}

/**
 * Choose the final advertised selector id for a target rank.
 *
 * Fallback modes:
 *   - nearest-up (compat): shortest rank distance, ties to the stronger level;
 *   - up: exact or the next higher; at the top, clamp to the highest allowed;
 *   - down: exact or the next lower; at the bottom, clamp to the lowest allowed.
 *
 * `allowedRanks` restricts the FINAL candidates (the global second layer).
 * An empty intersection is reported as unsupported; no level outside the
 * allow-list is ever fabricated.
 *
 * @returns {{ effort: string|undefined, rank: number|null, mapping: string,
 *             unknown: string[] }}
 */
export function effortForRank(targetRank, supported, options = {}) {
  const normalized = normalizeEfforts(supported)
  const target = Math.round(Number(targetRank) || 0)
  const fallback = ['nearest-up', 'up', 'down'].includes(options.fallback)
    ? options.fallback
    : 'nearest-up'
  const allowed = options.allowedRanks === null || options.allowedRanks === undefined
    ? null
    : new Set(options.allowedRanks)
  const candidates = normalized.items.filter((item) => allowed === null || allowed.has(item.rank))
  if (candidates.length === 0) {
    return { effort: undefined, rank: null, mapping: 'unsupported', unknown: normalized.unknown }
  }

  const canonical = tierForRank(target)
  const exact = candidates.find((item) => item.rank === target && item.id === canonical)
    || candidates.find((item) => item.rank === target)
  if (exact) {
    return { effort: exact.id, rank: exact.rank, mapping: 'exact', unknown: normalized.unknown }
  }

  if (fallback === 'up') {
    const higher = candidates.filter((item) => item.rank >= target)
    if (higher.length > 0) {
      higher.sort((a, b) => a.rank - b.rank)
      return { effort: higher[0].id, rank: higher[0].rank, mapping: 'up', unknown: normalized.unknown }
    }
    const highest = candidates.reduce((best, item) => (item.rank > best.rank ? item : best), candidates[0])
    return { effort: highest.id, rank: highest.rank, mapping: 'up-clamped', unknown: normalized.unknown }
  }

  if (fallback === 'down') {
    const lower = candidates.filter((item) => item.rank <= target)
    if (lower.length > 0) {
      lower.sort((a, b) => b.rank - a.rank)
      return { effort: lower[0].id, rank: lower[0].rank, mapping: 'down', unknown: normalized.unknown }
    }
    const lowest = candidates.reduce((best, item) => (item.rank < best.rank ? item : best), candidates[0])
    return { effort: lowest.id, rank: lowest.rank, mapping: 'down-clamped', unknown: normalized.unknown }
  }

  let best = candidates[0]
  let distance = Math.abs(best.rank - target)
  for (const item of candidates.slice(1)) {
    const nextDistance = Math.abs(item.rank - target)
    if (nextDistance < distance || (nextDistance === distance && item.rank > best.rank)) {
      best = item
      distance = nextDistance
    }
  }
  return { effort: best.id, rank: best.rank, mapping: 'nearest-up', unknown: normalized.unknown }
}

/**
 * Compatibility mapper used by fixed default/subagent paths and exported as
 * the public routing API. It is rank 3 (medium) on the new ladder and keeps
 * nearest-up fallback; normal Auto uses effortForRank with the allow-list.
 */
export function mapEffort(tier, supported) {
  if (!Array.isArray(supported) || supported.length === 0) return undefined
  if (tier === 'auto') return undefined
  const selected = effortForRank(rankOf(tier), supported, { fallback: 'nearest-up' })
  return selected.effort
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
  // dsh-token-meter's tokenUsage stateVersion 2 totals schema (strict):
  // uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens.
  // There is no `input`/`cacheRead`/`reasoning` key in the projection; reading
  // those legacy names silently made every session total 0.
  for (const key of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    if (Number.isFinite(totals[key])) sum += totals[key]
  }
  return sum
}