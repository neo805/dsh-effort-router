/**
 * dsh-effort-router — chat captions (config `chatAnnotate`, DEFAULT OFF).
 *
 * The R1 surface, revived in 0.2.7-rc.7 on the maintainer's call: a
 * conversation event-view anchors one node per tool/call, and the row renders
 * that call's provider/model · effort read from the host's
 * `effortRouterAnchors` session projection through the `useProjection` prop
 * (the same anchor table the trajectory decorator polls over the state route —
 * tool/call events anchor on the bare callId, see lib/anchors-projection.js).
 * A call the host has not folded yet renders nothing, so a fresh call can
 * never borrow another call's route.
 */
import { memo } from 'react'
import { createElement as h } from 'react'

export const ROUTE_KIND = 'effort-router-route'
/** Contract: lib/anchors-projection.js EFFORT_ANCHORS_KEY (stateVersion 2). */
export const ANCHORS_PROJECTION = 'effortRouterAnchors'

/** The conversation event-view definition (one anchored node per tool call). */
export const routeRowDefinition = {
  kind: ROUTE_KIND,
  target: 'chat',
  match: (event: any) => (event && event.type === 'tool/call'
    ? { id: String(event.data.callId), role: 'start' }
    : null),
  start: (_context: any, match: any) => ({
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    turn: match.event.data.turn,
    step: match.event.data.step,
    seq: match.event.seq,
  }),
  update: (context: any) => context.state,
  buildViewNode: (context: any) => {
    const state = context.state
    if (state === undefined || state === null) return null
    return {
      key: context.key,
      kind: ROUTE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: state.seq + 0.1,
      location: context.start && context.start.location ? context.start.location : { kind: 'unresolved' },
      visibility: 'visible',
      data: { callId: state.callId, name: state.name, turn: state.turn, step: state.step },
    }
  },
}

/** The caption row: `provider/model · effort` for one tool call. */
export const RouteRow = memo(function RouteRow(props: any) {
  let view: any = null
  try {
    const read = props && typeof props.useProjection === 'function' ? props.useProjection : null
    view = read ? read(ANCHORS_PROJECTION) : null
  } catch (_noProjection) {
    view = null
  }
  try {
    const node = props ? props.node : null
    const data = node ? node.data : null
    const callId = data ? String(data.callId || '') : ''
    const call = callId && view && view.anchors ? view.anchors[callId] : null
    if (!call) return null
    const provider = call.provider ? String(call.provider) : ''
    const model = call.model ? String(call.model) : ''
    const label = provider && model ? provider + '/' + model : (model || provider)
    if (!label) return null
    const effort = call.effort === null || call.effort === undefined || call.effort === ''
      ? (props.t ? props.t('annotation.default') : 'default')
      : String(call.effort)
    return h(
      'div',
      { className: 'er-call', title: label + ' · ' + effort },
      h('span', { className: 'er-call-model' }, label),
      h('span', { className: 'er-call-eff' }, '· ' + effort),
    )
  } catch (_noRow) {
    return null
  }
})
