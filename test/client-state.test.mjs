/**
 * Client polling/identity contracts that do not need a browser DOM:
 * response generations, badge ownership, and URL session-id extraction.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPollGuard } from '../src/client/poll-guard.js'
import { badgeEffortText, badgeForSession, sameBadgeState } from '../src/client/badge-state.js'
import { sessionIdFromUrl } from '../src/client/ids.js'

test('poll guard: a response captured before a session switch is stale', () => {
  const guard = createPollGuard()
  assert.equal(guard.updateSession(null), false, 'initial identity is already current')
  const initial = guard.snapshot()

  assert.equal(guard.updateSession('session-a'), true)
  assert.equal(guard.isCurrent(initial), false, 'the empty-session response is stale')

  const a = guard.snapshot()
  assert.equal(guard.isCurrent(a), true)
  assert.equal(guard.updateSession('session-a'), false, 'same session keeps the generation')
  assert.equal(guard.isCurrent(a), true)

  assert.equal(guard.updateSession('session-b'), true)
  assert.equal(guard.isCurrent(a), false, 'A must never paint B after the switch')
  const b = guard.snapshot()
  assert.equal(b.sessionId, 'session-b')
  assert.equal(b.hint, null, 'a session change clears the old tool hint')
  assert.equal(guard.isCurrent(b), true)
})

test('poll guard: hint identity is generation-scoped when no session id exists', () => {
  const guard = createPollGuard()
  guard.updateSession(null)
  assert.equal(guard.updateHint('call-1'), true)
  const first = guard.snapshot()
  assert.equal(guard.isCurrent(first), true)
  assert.equal(guard.updateHint('call-1'), false)
  assert.equal(guard.updateHint('call-2'), true)
  assert.equal(guard.isCurrent(first), false, 'a different on-screen call invalidates the response')
  const second = guard.snapshot()
  assert.equal(second.hint, 'call-2')
  assert.equal(guard.isCurrent(second), true)
  // A known session id owns identity again; the hint is not compared.
  assert.equal(guard.updateSession('session-a'), true)
  assert.equal(guard.snapshot().hint, null)
})

test('badge state is only rendered for the session it was fetched for', () => {
  const state = { sessionId: 'session-a', ok: true, enabled: true, last: { effort: 'high' } }
  assert.equal(badgeForSession(state, 'session-a'), state)
  assert.equal(badgeForSession(state, 'session-b'), null)
  assert.equal(badgeForSession(state, undefined), null)
  assert.equal(badgeForSession(null, 'session-a'), null)
})

test('same badge view suppresses identical polling renders', () => {
  const first = {
    sessionId: 's', ok: true, enabled: true, showBadge: true,
    last: { mode: 'auto', effort: 'high', tier: 'high', stepClass: 'engineering', reason: 'x' },
  }
  assert.equal(sameBadgeState(first, { ...first, last: { ...first.last } }), true)
  assert.equal(sameBadgeState(first, { ...first, last: { ...first.last, effort: 'low' } }), false)
  assert.equal(sameBadgeState(first, { ...first, showBadge: false }), false)
  assert.equal(sameBadgeState(first, { ...first, sessionId: 'other' }), false)
})

test('badge shows the ACTUAL effort, never the target tier as a fallback', () => {
  assert.equal(badgeEffortText({ effort: 'high', tier: 'max' }), 'high')
  assert.equal(badgeEffortText({ effort: null, tier: 'off' }), '')
  assert.equal(badgeEffortText({ effort: undefined, tier: 'high' }), '')
  assert.equal(badgeEffortText(null), '')
})

test('sessionIdFromUrl preserves the ordinary session- prefix', () => {
  const uuid = '12345678-1234-1234-1234-123456789abc'
  assert.equal(sessionIdFromUrl('http://127.0.0.1:51988/session/session-' + uuid), 'session-' + uuid)
  assert.equal(sessionIdFromUrl('http://127.0.0.1:51988/?sessionId=session-' + uuid), 'session-' + uuid)
  assert.equal(sessionIdFromUrl('http://127.0.0.1:51988/#/agent/' + uuid), uuid)
  assert.equal(sessionIdFromUrl('http://127.0.0.1:51988/not-a-session'), null)
  assert.equal(sessionIdFromUrl(undefined), null)
})