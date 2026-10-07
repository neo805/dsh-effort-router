/**
 * routing.js unit tests — tier mapping, hysteresis, projection readers.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activeTodoText,
  contextPressureRatio,
  effortTierForClass,
  mapEffort,
  sessionTokensOf,
  stabilize,
} from '../lib/routing.js'

test('mapEffort: exact id wins', () => {
  assert.equal(mapEffort('high', ['off', 'low', 'high', 'max']), 'high')
})

test('mapEffort: missing tier maps to nearest advertised rank', () => {
  // low(2) missing: medium(3) is nearer than off(0)
  assert.equal(mapEffort('low', ['off', 'medium', 'high']), 'medium')
  // max(6) on a 3-level model -> high
  assert.equal(mapEffort('max', ['off', 'low', 'high']), 'high')
})

test('mapEffort: ties resolve to the STRONGER level (toggle-only model)', () => {
  // low(2) on an off(0)/high(4) toggle model -> high (thinking on, never off)
  assert.equal(mapEffort('low', ['off', 'high']), 'high')
})

test('mapEffort: custom gateway vocabulary (ultra)', () => {
  assert.equal(mapEffort('max', ['off', 'high', 'ultra']), 'ultra')
  assert.equal(mapEffort('high', ['off', 'ultra']), 'ultra') // high(4) nearer to ultra(7) than off(0)
})

test('mapEffort: no advertised efforts -> undefined', () => {
  assert.equal(mapEffort('high', []), undefined)
  assert.equal(mapEffort('high', undefined), undefined)
})

test('effortTierForClass: reads the route table, validates values', () => {
  const cfg = { routes: { trivial: 'low', standard: 'low', engineering: 'high', hard: 'max' } }
  assert.equal(effortTierForClass(cfg, 'engineering'), 'high')
  assert.equal(effortTierForClass({ routes: { engineering: 'bogus' } }, 'engineering'), 'low')
})

test('stabilize: raises apply immediately', () => {
  const r = stabilize('high', 'low', 0, 2)
  assert.equal(r.value, 'high')
  assert.equal(r.streak, 0)
})

test('stabilize: downgrades wait for downAfter quiet decisions', () => {
  let s = { value: 'high', streak: 0 }
  s = stabilize('low', s.value, s.streak, 2) // 1st quieter: held
  assert.equal(s.value, 'high')
  assert.equal(s.streak, 1)
  s = stabilize('low', s.value, s.streak, 2) // 2nd quieter: applies
  assert.equal(s.value, 'low')
  assert.equal(s.streak, 0)
})

test('stabilize: a louder step resets the quiet streak', () => {
  let s = stabilize('low', 'high', 0, 2) // held, streak 1
  s = stabilize('max', s.value, s.streak, 2) // raise applies, streak reset
  assert.equal(s.value, 'max')
  assert.equal(s.streak, 0)
})

test('activeTodoText prefers the in_progress item', () => {
  const todos = [
    { status: 'completed', content: 'done' },
    { status: 'in_progress', content: 'doing' },
  ]
  assert.equal(activeTodoText(todos), 'doing')
  assert.equal(activeTodoText(undefined), '')
})

test('contextPressureRatio / sessionTokensOf', () => {
  assert.equal(contextPressureRatio({ contextWindow: 100, pressureTokens: 80 }), 0.8)
  assert.equal(contextPressureRatio({}), null)
  assert.equal(sessionTokensOf({ totals: { input: 3, output: 4, reasoning: 5 } }), 12)
  assert.equal(sessionTokensOf(undefined), 0)
})
