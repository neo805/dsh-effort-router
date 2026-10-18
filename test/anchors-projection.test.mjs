/**
 * anchors-projection.js tests — header folds, call/message anchors, eviction.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effortAnchorsProjection as projection } from '../lib/anchors-projection.js'

const header = (provider, model, effort) => ({
  type: 'request/header',
  data: { header: { config: { provider, model, reasoningEffort: effort } } },
})
const call = (callId) => ({ type: 'tool/call', data: { callId } })
const message = (id, turn, step) => ({ type: 'assistant/message', data: { message: { id, role: 'assistant', content: [] }, turn, step } })

test('anchors fold the header in force at each call/message event', () => {
  let state = projection.init()
  state = projection.apply(state, header('moonshotai-cn', 'kimi-k3', 'low'))
  state = projection.apply(state, call('call_1'))
  state = projection.apply(state, message('msg-1', 3, 1))
  state = projection.apply(state, header('moonshotai-cn', 'kimi-k3', 'high'))
  state = projection.apply(state, call('call_2'))
  assert.deepEqual(state.anchors.call_1, { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'low' })
  // message anchors key by 'assistant\0turn\0step' (the trajectory row key),
  // not by the message id.
  assert.deepEqual(state.anchors[['assistant', '3', '1'].join('\0')], { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'low' })
  assert.equal(state.anchors['msg-1'], undefined)
  assert.deepEqual(state.anchors.call_2, { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'high' })
  assert.deepEqual(projection.wire.view(state), { anchors: state.anchors })
})

test('a message event without turn/step falls back to the message id', () => {
  let state = projection.init()
  state = projection.apply(state, header('p', 'm', 'low'))
  state = projection.apply(state, { type: 'assistant/message', data: { message: { id: 'msg-legacy', role: 'assistant', content: [] } } })
  assert.ok(state.anchors['msg-legacy'], 'legacy logs keep the message-id anchor')
})

test('events before any header, duplicate anchors, and unchanged headers are no-ops', () => {
  let state = projection.init()
  state = projection.apply(state, call('call_early'))
  assert.deepEqual(state.anchors, {}, 'no header yet: nothing to anchor')
  state = projection.apply(state, header('p', 'm', 'low'))
  const stamped = projection.apply(state, header('p', 'm', 'low'))
  assert.equal(stamped, state, 'unchanged header returns the same state')
  state = projection.apply(stamped, call('call_1'))
  const again = projection.apply(state, call('call_1'))
  assert.equal(again, state, 'an anchor id is never rewritten')
})

test('a null reasoningEffort is preserved as null, never the string "null"', () => {
  let state = projection.init()
  state = projection.apply(state, { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: null } } } })
  state = projection.apply(state, call('c'))
  assert.equal(state.anchors.c.effort, null)
})

test('anchors beyond the limit evict the oldest first', () => {
  let state = projection.init()
  state = projection.apply(state, header('p', 'm', 'low'))
  for (let i = 0; i < 505; i += 1) state = projection.apply(state, call('call_' + i))
  assert.equal(Object.keys(state.anchors).length, 500)
  assert.equal(state.anchors.call_0, undefined, 'the oldest anchor aged out')
  assert.equal(state.anchors.call_4, undefined)
  assert.ok(state.anchors.call_5, 'the 501st newest is kept')
})

test('the registry-facing schemas are identity parsers (clone-safe wire contract)', () => {
  const state = projection.apply(projection.init(), header('p', 'm', 'low'))
  assert.equal(projection.stateSchema.parse(state), state)
  const view = projection.wire.view(state)
  assert.equal(projection.wire.viewSchema.parse(view), view)
  // The registry structuredClones the state for checkpointing and replays it,
  // so the served view must survive a JSON round trip unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view)
})
