/**
 * anchors-resolve.js — anchor-table resolution for the state route's merged
 * fallback. Pure module: the route builds the ordered candidate list, this
 * module decides which table the client should decorate against.
 *
 * Why it exists: assistant anchor keys are 'assistant\0<turn>\0<step>' —
 * per-session coordinates, NOT globally unique — so a merged table collides
 * across sessions and `Object.assign` used to decide whose capsule painted
 * on a colliding row (0.2.6 bug report: a deepseek-flash session showed the
 * capsules of an unrelated kimi-k3 session). Two mitigations, in order:
 *
 *  1. hint — the client sends one tool call id visible on screen; call ids
 *     ARE globally unique, so the owning session's own table resolves the
 *     whole screen collision-free.
 *  2. newest-wins merge — without a hint (no tool rows visible), merge
 *     oldest → newest so the most recently active session wins collisions;
 *     the on-screen session usually is the newest one.
 *
 * candidates: [{ id, anchors }] ordered oldest → most-recently-active;
 * `anchors` may be nullish (session without a projection yet).
 */

export function resolveMergedAnchors(candidates, hint) {
  if (hint) {
    // Scan most-recent first for speed only: call ids are unique, so any hit
    // is THE owner regardless of order.
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const anchors = candidates[i] && candidates[i].anchors
      if (anchors && Object.prototype.hasOwnProperty.call(anchors, hint)) {
        return { table: anchors, resolved: 'hint' }
      }
    }
  }
  const merged = {}
  let sessions = 0
  for (const candidate of candidates) {
    const anchors = candidate && candidate.anchors
    if (!anchors) continue
    sessions += 1
    Object.assign(merged, anchors)
  }
  return sessions > 0 ? { table: merged, resolved: 'merged' } : null
}
