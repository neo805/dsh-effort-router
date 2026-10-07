/**
 * route-projection.js — two layers:
 *   1. a self-contained synthetic fold test (always runs);
 *   2. an optional replay of a REAL session log through the fold, gated behind
 *      the DSH_EFFORT_ROUTER_REPLAY_LOG environment variable (point it at a
 *      session .jsonl). The shipped log's ground truth: request/header effort
 *      history is 'low' twice and nothing else, so every labeled tool call of
 *      that log must read provider deepseek-* and effort 'low'.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { effortRouteProjection } from '../lib/route-projection.js'

const LOG = process.env.DSH_EFFORT_ROUTER_REPLAY_LOG
const hasReplayLog = typeof LOG === 'string' && LOG.length > 0 && existsSync(LOG)

test('projection fold labels every tool call with the header in force', { skip: !hasReplayLog }, () => {
  const events = readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))

  let state = effortRouteProjection.init()
  let headers = 0
  let toolCalls = 0
  for (const event of events) {
    if (event.type === 'request/header') headers += 1
    if (event.type === 'tool/call') toolCalls += 1
    state = effortRouteProjection.apply(state, event)
  }

  assert.ok(headers >= 2, 'expected at least the two recorded headers')
  assert.ok(toolCalls > 100, 'expected the 460-step session to carry many tool calls')

  const view = effortRouteProjection.wire.view(state)
  const labeled = Object.values(view.calls)
  assert.ok(labeled.length > 100)
  for (const call of labeled) {
    assert.equal(call.effort, 'low', 'this session never left low (audit ground truth)')
    assert.ok(call.provider && call.provider.startsWith('deepseek'))
    assert.ok(call.model)
  }
  assert.deepEqual(view.latest.effort, 'low')
})

test('projection fold is incremental and identity-stable on unrelated events', () => {
  let state = effortRouteProjection.init()
  const before = state
  state = effortRouteProjection.apply(state, { type: 'session', data: {} })
  assert.equal(state, before, 'unrelated events return the same reference')
  state = effortRouteProjection.apply(state, {
    type: 'request/header',
    seq: 10,
    data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'high' } } },
  })
  state = effortRouteProjection.apply(state, { type: 'step/start', seq: 11, data: { turn: 1, step: 2 } })
  state = effortRouteProjection.apply(state, { type: 'tool/call', seq: 12, data: { callId: 'c1', name: 'read' } })
  assert.deepEqual(state.calls.c1, { turn: 1, step: 2, provider: 'p', model: 'm', effort: 'high' })
})
