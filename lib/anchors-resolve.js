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
 *  2. ambiguity-safe merge — without identity (no hint, no session id) the
 *     per-session coordinates COLLIDE by construction, and "newest wins"
 *     would paint another session's capsule whenever the on-screen session
 *     is not the newest (the 2026-10-18 Web report: switching panes showed
 *     the previous session's provider/model, or nothing at all). A key whose
 *     value is not identical across every table that contains it is
 *     dropped: missing captions are honest, wrong ones are not. Keys that
 *     are unique or agree across sessions still decorate.
 *
 * candidates: [{ id, anchors }] ordered oldest → most-recently-active;
 * `anchors` may be nullish (session without a projection yet).
 */

/** Same provider/model/effort triple? */
function sameAnchor(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  return left.provider === right.provider && left.model === right.model && left.effort === right.effort
}

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
  const conflicted = new Set()
  let sessions = 0
  for (const candidate of candidates) {
    const anchors = candidate && candidate.anchors
    if (!anchors) continue
    sessions += 1
    for (const [key, value] of Object.entries(anchors)) {
      if (conflicted.has(key)) continue
      const existing = merged[key]
      if (existing === undefined) {
        merged[key] = value
        continue
      }
      if (!sameAnchor(existing, value)) {
        conflicted.add(key)
        delete merged[key]
      }
    }
  }
  return sessions > 0 ? { table: merged, resolved: 'merged' } : null
}
