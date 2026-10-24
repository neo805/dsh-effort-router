/**
 * routing.js unit tests — tier mapping, projection readers.
 * (stabilize/activeTodoText retired in 0.2.8 with the drift engine.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contextPressureRatio,
  mapEffort,
  rankOf,
  sessionTokensOf,
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

test('mapEffort: the Auto sentinel is never a concrete target', () => {
  // Auto is the plugin's own virtual selector entry. Fixed default/subagent
  // paths used to pass the full advertised list straight through, so medium
  // could take the equal-distance tie to the stronger unknown id 'auto'.
  assert.equal(mapEffort('medium', ['low', 'high', 'auto']), 'high')
  assert.equal(mapEffort('auto', ['low', 'high', 'auto']), undefined)
  assert.equal(mapEffort('low', ['auto']), undefined, 'no concrete level is better than a sentinel')
})

test('rankOf: inherited object properties are not effort identifiers', () => {
  assert.equal(rankOf('toString'), 4, 'unknown ids fall back to high')
  assert.equal(rankOf('constructor'), 4)
  assert.equal(mapEffort('low', ['toString']), 'toString', 'unknown advertised id is still ranked safely')
})

test('contextPressureRatio / sessionTokensOf', () => {
  assert.equal(contextPressureRatio({ contextWindow: 100, pressureTokens: 80 }), 0.8)
  assert.equal(contextPressureRatio({}), null)
  assert.equal(sessionTokensOf({ totals: { input: 3, output: 4, reasoning: 5 } }), 12)
  assert.equal(sessionTokensOf(undefined), 0)
})
