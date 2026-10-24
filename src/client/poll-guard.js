/**
 * Generation guard for the trajectory poller (plain ESM, unit-testable).
 *
 * A fetch started for session A can resolve after the pane switched to B. A
 * clear-on-switch alone cannot stop it: the stale body then rewrites the global
 * anchor table and repaints B with A's per-session `assistant/turn/step`
 * coordinates. Every request captures a snapshot; a response may be applied
 * only while that snapshot is still current.
 *
 * Identity is the conversation session when one is known, otherwise the
 * visible tool-call hint (globally unique, used by the merged fallback).
 */
export function createPollGuard() {
  let generation = 0
  let sessionId = null
  let hint = null

  return {
    updateSession(next) {
      const value = typeof next === 'string' && next !== '' ? next : null
      if (value === sessionId) return false
      sessionId = value
      // A session owns identity; any old hint belongs to the previous pane.
      hint = null
      generation += 1
      return true
    },
    updateHint(next) {
      if (sessionId !== null) return false
      const value = typeof next === 'string' && next !== '' ? next : null
      if (value === hint) return false
      hint = value
      generation += 1
      return true
    },
    snapshot() {
      return { generation, sessionId, hint }
    },
    isCurrent(token) {
      return !!token
        && token.generation === generation
        && token.sessionId === sessionId
        && token.hint === hint
    },
  }
}