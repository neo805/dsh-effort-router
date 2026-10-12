/**
 * anchors-resolve.js tests — hint resolution and newest-wins merging for the
 * state route's merged fallback. Assistant anchor keys collide across
 * sessions (per-session turn/step coordinates); tool call ids do not.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveMergedAnchors } from '../lib/anchors-resolve.js'

const KIMI = { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'low' }
const FLASH = { provider: 'deepseek-account', model: 'deepseek-flash', effort: 'max' }
const ASSISTANT_KEY = ['assistant', '1', '1'].join('\0')

// Two sessions whose assistant keys COLLIDE (same turn/step coordinates),
// the exact shape of the 0.2.6 wrong-attribution bug report.
const older = { id: 's-old', anchors: { [ASSISTANT_KEY]: KIMI, call_old: KIMI } }
const newer = { id: 's-new', anchors: { [ASSISTANT_KEY]: FLASH, call_new: FLASH } }

test('a hint resolves the owning session despite colliding assistant keys', () => {
  const out = resolveMergedAnchors([older, newer], 'call_old')
  assert.equal(out.resolved, 'hint')
  assert.equal(out.table, older.anchors, 'the owning session table comes back by identity')
  assert.equal(out.table[ASSISTANT_KEY].model, 'kimi-k3')

  const out2 = resolveMergedAnchors([older, newer], 'call_new')
  assert.equal(out2.resolved, 'hint')
  assert.equal(out2.table, newer.anchors)
  assert.equal(out2.table[ASSISTANT_KEY].model, 'deepseek-flash')
})

test('merged fallback without a hint: newest session wins colliding keys', () => {
  const out = resolveMergedAnchors([older, newer], undefined)
  assert.equal(out.resolved, 'merged')
  assert.equal(out.table[ASSISTANT_KEY].model, 'deepseek-flash', 'last candidate wins the collision')
  // Globally-unique tool call keys from every session survive the merge.
  assert.equal(out.table.call_old.model, 'kimi-k3')
  assert.equal(out.table.call_new.model, 'deepseek-flash')
})

test('an unknown hint falls through to the merged table', () => {
  const out = resolveMergedAnchors([older, newer], 'call_nope')
  assert.equal(out.resolved, 'merged')
  assert.equal(out.table[ASSISTANT_KEY].model, 'deepseek-flash')
})

test('candidates without anchors are skipped; empty input yields null', () => {
  assert.equal(resolveMergedAnchors([], 'x'), null)
  assert.equal(resolveMergedAnchors([{ id: 's1', anchors: null }], undefined), null)
  const out = resolveMergedAnchors([{ id: 's1', anchors: null }, newer], undefined)
  assert.equal(out.resolved, 'merged')
  assert.deepEqual(out.table, newer.anchors)
})

test('the hint also finds owners outside the newest merge slice', () => {
  // The on-screen session may be idle (viewed from history) while eight
  // other sessions were active since — the hint must still find it whenever
  // it sits anywhere in the candidate list the route supplied.
  const padding = Array.from({ length: 8 }, (_, i) => ({
    id: 's-pad-' + i,
    anchors: { ['call_pad_' + i]: FLASH },
  }))
  const out = resolveMergedAnchors([older, ...padding], 'call_old')
  assert.equal(out.resolved, 'hint')
  assert.equal(out.table, older.anchors)
})
