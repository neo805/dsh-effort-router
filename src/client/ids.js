/**
 * dsh-effort-router — session identity & trajectory row keys (plain ESM).
 *
 * Kept OUTSIDE the TSX/TS client files on purpose: this is the identity
 * contract the trajectory decorator depends on, and it must be unit-testable
 * from `node --test` without a TS loader. esbuild bundles this module into the
 * client exactly like the TypeScript sources.
 *
 * Two id shapes exist in DSH: an ordinary conversation session is
 * `session-<uuid>`, while an agent created through the agent service (a
 * subagent, and anything else spawned the same way) carries a BARE `<uuid>`.
 * The decorator must accept both, or a subagent pane loses its identity and
 * falls back to the merged anchor table — whose per-session
 * `assistant\0<turn>\0<step>` keys collide and paint a neighbour's capsule (or
 * none at all). That regression was reported 2026-10-18 for a live subagent.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Anchored matcher for a whole session id, both shapes. */
export const SESSION_ID_RE = new RegExp('^(?:session-)?' + UUID + '$', 'i')

/** Unanchored matcher used to pull an id out of a URL. */
export const SESSION_ID_IN_URL_RE = new RegExp(UUID, 'i')

/** Is this string a session id (either shape)? */
export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

/** The tool-row prefix the trajectory ledger uses for call anchors. */
export const TOOL_ROW_PREFIX = 'tool\0call\0'

/**
 * Resolve one trajectory row's DOM key (`data-trajectory-row-key`, percent
 * encoded) to an anchor id: the bare callId for tool rows, the decoded
 * `assistant\0<turn>\0<step>` key for message rows.
 */
export function anchorOfRowKey(rowKey) {
  if (typeof rowKey !== 'string' || rowKey === '') return null
  let key
  try {
    key = decodeURIComponent(rowKey)
  } catch {
    return null
  }
  if (key.startsWith(TOOL_ROW_PREFIX)) {
    const callId = key.slice(TOOL_ROW_PREFIX.length)
    return callId === '' ? null : callId
  }
  return key === '' ? null : key
}
