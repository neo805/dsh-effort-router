/**
 * dsh-effort-router — per-tool-call effort projection.
 *
 * Ported from @neptune810/dsh-model-router v0.14.0 lib/route-projection.js
 * (MIT, Copyright Neptune810), renamed and cut to the effort annotation:
 * the chat surface offers exactly one seam for "what did this call run with"
 * (a keyed conversation row), so this host-side unit folds
 *
 *   'request/header'  (emitted when the envelope changes; carries the effort)
 *   'step/start'      (turn/step coordinates)
 *   'tool/call'       (the anchor; carries turn/step but not the effort)
 *
 * into a per-call table the client renders next to every tool call.
 *
 * The shape is a durable contract with the client bundle — bump stateVersion
 * whenever it changes, and keep it plain JSON: the projection registry
 * structuredClones the state for checkpointing and replays it.
 */

/** Tool calls kept per session; the oldest are dropped past this. */
const CALL_LIMIT = 200

/** JSON-safe text, or null for a missing value. */
function textOf(value) {
  return value === undefined || value === null ? null : String(value)
}

/** JSON-safe number, or null. */
function numberOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const EFFORT_PROJECTION_KEY = 'effortRouterRoute'

/**
 * Session projection: the provider/model/effort in force for every tool call.
 * Registered by lib/index.js with ctx.inject(['sessionProjections'], ...).
 */
export const effortRouteProjection = {
  key: EFFORT_PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: { parse: (value) => value },

  init: () => ({ header: null, at: null, calls: {}, order: [] }),

  apply(state, event) {
    const type = event ? event.type : undefined
    const data = (event && event.data) || {}

    if (type === 'request/header') {
      const config = data.header ? data.header.config : undefined
      if (!config) return state
      const next = {
        provider: textOf(config.provider),
        model: textOf(config.model),
        // The adapter may own the default: absence is meaningful, and an
        // explicit null must not become the string "null".
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

    if (type === 'step/start') {
      const next = { turn: numberOf(data.turn), step: numberOf(data.step) }
      const previous = state.at
      if (previous && previous.turn === next.turn && previous.step === next.step) return state
      return { ...state, at: next }
    }

    if (type === 'tool/call') {
      const callId = textOf(data.callId)
      if (callId === null) return state
      const header = state.header || {}
      const at = state.at || {}
      const turn = at.turn === undefined || at.turn === null ? numberOf(data.turn) : at.turn
      const step = at.step === undefined || at.step === null ? numberOf(data.step) : at.step
      const entry = {
        turn,
        step,
        provider: header.provider === undefined ? null : header.provider,
        model: header.model === undefined ? null : header.model,
        effort: header.effort === undefined ? null : header.effort,
      }
      const calls = { ...state.calls, [callId]: entry }
      // Integer-like call ids are ordered numerically by the engine, so the cap
      // follows an explicit oldest-first list instead of Object.keys.
      const known = state.order || []
      const order = known.includes(callId) ? known : known.concat([callId])
      if (order.length <= CALL_LIMIT) return { ...state, calls, order }
      const excess = order.length - CALL_LIMIT
      for (const dropped of order.slice(0, excess)) delete calls[dropped]
      return { ...state, calls, order: order.slice(excess) }
    }

    return state
  },

  wire: {
    viewSchema: { parse: (value) => value },
    view: (state) => ({ calls: state.calls, latest: state.header }),
  },
}
