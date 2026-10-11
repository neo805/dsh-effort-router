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
const message = (id) => ({ type: 'assistant/message', data: { message: { id, role: 'assistant', content: [] } } })

test('anchors fold the header in force at each call/message event', () => {
  let state = projection.init()
  state = projection.apply(state, header('moonshotai-cn', 'kimi-k3', 'low'))
  state = projection.apply(state, call('call_1'))
  state = projection.apply(state, message('msg-1'))
  state = projection.apply(state, header('moonshotai-cn', 'kimi-k3', 'high'))
  state = projection.apply(state, call('call_2'))
  assert.deepEqual(state.anchors.call_1, { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'low' })
  assert.deepEqual(state.anchors['msg-1'], { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'low' })
  assert.deepEqual(state.anchors.call_2, { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'high' })
  assert.deepEqual(projection.wire.view(state), { anchors: state.anchors })
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
