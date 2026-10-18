/**
 * Client identity contract tests (src/client/ids.js).
 *
 * The trajectory decorator identifies the on-screen session from the DOM and
 * resolves each row's anchor key. Both had a `session-`-prefixed assumption
 * that broke subagent panes: an agent session id is a BARE uuid, so validation
 * failed, the decorator fell back to the merged table, and the caption either
 * vanished or carried a neighbouring session's provider (reported 2026-10-18).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorOfRowKey, isSessionId, TOOL_ROW_PREFIX } from '../src/client/ids.js'

const UUID = 'b653563f-710c-4866-aef1-119763e95657'

test('isSessionId: an ordinary conversation id is accepted', () => {
  assert.equal(isSessionId('session-462a743a-8451-429b-b239-f1ceaf1afaa1'), true)
  assert.equal(isSessionId('SESSION-462A743A-8451-429B-B239-F1CEAF1AFAA1'), true, 'case-insensitive')
})

test('isSessionId: a BARE agent (subagent) uuid is accepted — the subagent-pane regression', () => {
  assert.equal(isSessionId(UUID), true)
})

test('isSessionId: junk and partial ids are rejected', () => {
  for (const bad of [null, undefined, '', 'not-a-session', 'session-', UUID.slice(0, 8), UUID + '-extra']) {
    assert.equal(isSessionId(bad), false, 'rejects ' + String(bad))
  }
})

test('anchorOfRowKey: tool rows resolve to the bare call id', () => {
  const rowKey = encodeURIComponent(TOOL_ROW_PREFIX + 'call_abc123')
  assert.equal(anchorOfRowKey(rowKey), 'call_abc123')
})

test('anchorOfRowKey: assistant rows keep their turn/step key verbatim', () => {
  const key = 'assistant' + String.fromCharCode(0) + '1' + String.fromCharCode(0) + '1'
  assert.equal(anchorOfRowKey(encodeURIComponent(key)), key)
})

test('anchorOfRowKey: malformed or empty keys resolve to null (never paint)', () => {
  assert.equal(anchorOfRowKey('%E0%A4%A'), null, 'invalid percent-encoding')
  assert.equal(anchorOfRowKey(''), null)
  assert.equal(anchorOfRowKey(encodeURIComponent(TOOL_ROW_PREFIX)), null, 'prefix alone is not a call id')
  assert.equal(anchorOfRowKey(undefined), null)
})
