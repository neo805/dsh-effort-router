/**
 * Badge state ownership + equality (plain ESM, unit-testable).
 *
 * React reuses the slot component when the composer switches sessions, so a
 * bare `useState` keeps the previous session's decision until the new fetch
 * succeeds (or forever, if it keeps failing). The stored state therefore
 * carries the session it belongs to and is rendered only when that matches.
 */

/** The state if it belongs to this session, otherwise null. */
export function badgeForSession(state, sessionId) {
  if (!state || !sessionId) return null
  return state.sessionId === sessionId ? state : null
}

/** Same rendered decision? Avoids a re-render for every unchanged 2.5 s poll. */
export function sameBadgeState(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.sessionId !== right.sessionId
    || left.ok !== right.ok
    || left.enabled !== right.enabled
    || left.showBadge !== right.showBadge) return false
  const a = left.last
  const b = right.last
  if (a === b) return true
  if (!a || !b) return false
  return a.mode === b.mode
    && a.effort === b.effort
    && a.tier === b.tier
    && a.stepClass === b.stepClass
    && a.reason === b.reason
}