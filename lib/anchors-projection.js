/**
 * dsh-effort-router — per-step effort ANCHOR projection.
 *
 * The native trajectory view numbers requests inside its own bundle and never
 * exposes turn/step or request config on its default rows — but its row DOM
 * keys ARE stable anchors (data-trajectory-row-key, trajectoryRecordId):
 *
 *   - tool rows:      'tool\0call\0<callId>'
 *   - message rows:   'assistant\0<turn>\0<step>'   (NOT the message id —
 *                     the view keys assistant cells by turn/step)
 *
 * This host-side unit folds the session events that carry those same ids
 *
 *   'request/header'    (the effort in force; stamped after our interceptor)
 *   'assistant/message' (carries data.turn + data.step as safe integers)
 *   'tool/call'         (carries callId)
 *
 * into an anchor → { provider, model, effort } table. The read-only state
 * route serves it to the client, whose DOM projection decorates the native
 * trajectory rows in place (no host package is touched, no chat-flow surface
 * is added).
 *
 * The shape is a durable contract with the client bundle — bump stateVersion
 * whenever it changes, and keep it plain JSON: the projection registry
 * structuredClones the state for checkpointing and replays it.
 */

/** Anchors kept per session; the oldest are dropped past this. */
const ANCHOR_LIMIT = 500

/** JSON-safe text, or null for a missing value. */
function textOf(value) {
  return value === undefined || value === null ? null : String(value)
}

export const EFFORT_ANCHORS_KEY = 'effortRouterAnchors'

/**
 * Session projection: anchor id -> the provider/model/effort of the step that
 * produced it. Registered by lib/index.js with
 * ctx.inject(['sessionProjections'], ...).
 */
export const effortAnchorsProjection = {
  key: EFFORT_ANCHORS_KEY,
  stateVersion: 2,
  stateSchema: { parse: (value) => value },

  init: () => ({ header: null, anchors: {}, order: [] }),

  apply(state, event) {
    const type = event ? event.type : undefined
    const data = (event && event.data) || {}

    if (type === 'request/header') {
      const config = data.header ? data.header.config : undefined
      if (!config) return state
      const next = {
        provider: textOf(config.provider),
        model: textOf(config.model),
        effort: config.reasoningEffort === undefined || config.reasoningEffort === null
          ? null
          : String(config.reasoningEffort),
      }
      const previous = state.header
      if (
        previous &&
        previous.provider === next.provider &&
        previous.model === next.model &&
        previous.effort === next.effort
      ) {
        return state
      }
      return { ...state, header: next }
    }

    let anchor = null
    if (type === 'assistant/message') {
      // The trajectory view keys assistant cells 'assistant\0turn\0step'
      // (trajectoryRecordId), and the event validator REQUIRES data.turn and
      // data.step to be non-negative safe integers — so this key always
      // exists. message.id is kept only as a fallback for replayed logs that
      // predate the validator.
      const turn = data.turn
      const step = data.step
      if (Number.isSafeInteger(turn) && Number.isSafeInteger(step) && turn >= 0 && step >= 0) {
        anchor = 'assistant\0' + String(turn) + '\0' + String(step)
      } else {
        const message = data.message
        anchor = message && message.id !== undefined && message.id !== null ? String(message.id) : null
      }
    } else if (type === 'tool/call') {
      anchor = data.callId !== undefined && data.callId !== null ? String(data.callId) : null
    }
    if (anchor === null || state.header === null) return state
    if (state.anchors[anchor] !== undefined) return state
    const anchors = {
      ...state.anchors,
      [anchor]: {
        provider: state.header.provider,
        model: state.header.model,
        effort: state.header.effort,
      },
    }
    const order = (state.order || []).concat([anchor])
    if (order.length <= ANCHOR_LIMIT) return { ...state, anchors, order }
    const excess = order.length - ANCHOR_LIMIT
    for (const dropped of order.slice(0, excess)) delete anchors[dropped]
    return { ...state, anchors, order: order.slice(excess) }
  },

  wire: {
    viewSchema: { parse: (value) => value },
    view: (state) => ({ anchors: state.anchors }),
  },
}
