/**
 * custom-models.js unit tests — candidate scan, gated fill, per-model edits.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EFFORT_TABLE,
  fillCandidates,
  isCustomGateway,
  normalizeEffortTable,
  validateEffortTable,
  withDefaultEfforts,
  withModelEfforts,
} from '../lib/custom-models.js'

test('DEFAULT_EFFORT_TABLE passes the pi-ai gate shape (off is null, never empty string)', () => {
  assert.deepEqual(validateEffortTable(DEFAULT_EFFORT_TABLE), [])
  assert.equal(DEFAULT_EFFORT_TABLE.off, null)
})

test('normalizeEffortTable: blank off -> null, blank others dropped, values kept', () => {
  assert.deepEqual(
    normalizeEffortTable({ off: '', low: 'low', high: '  ', junk: undefined }),
    { off: null, low: 'low' },
  )
})

test('validateEffortTable mirrors the pi-ai gate', () => {
  assert.deepEqual(validateEffortTable({ off: null, high: 'high' }), [])
  assert.ok(validateEffortTable({}).length > 0)                    // empty
  assert.ok(validateEffortTable({ off: null }).length > 0)          // no thinking level
  assert.ok(validateEffortTable({ high: '' }).length > 0)           // empty string wire
  assert.ok(validateEffortTable({ high: null }).length > 0)         // null on non-off
  assert.ok(validateEffortTable({ high: 42 }).length > 0)           // non-string wire
})

const section = {
  providers: {
    'my-gateway': {
      api: 'openai-completions',
      baseURL: 'https://gateway.internal.example/v1',
      models: [
        { id: 'thinker' },                                       // candidate
        { id: 'declared', reasoningEfforts: { high: 'ultra' } }, // explicit -> never
        { id: 'plain', reasoningEfforts: false },                // false -> never
      ],
    },
    'catalog-route': {
      models: [{ id: 'catalog-model' }],                         // candidate (gate decides)
      modelOverrides: {
        'other-model': { name: 'Override' },                     // candidate
        'shaped': { reasoningEfforts: { high: 'high' } },        // explicit -> never
      },
    },
  },
}

test('isCustomGateway', () => {
  assert.equal(isCustomGateway({ api: 'openai-completions' }), true)
  assert.equal(isCustomGateway({ baseURL: 'https://gw.corp.example' }), true)
  assert.equal(isCustomGateway({ baseURL: 'https://api.deepseek.com' }), false)
  assert.equal(isCustomGateway({}), false)
  assert.equal(isCustomGateway(undefined), false)
})

test('fillCandidates enumerates absent-table rows across models[] and modelOverrides', () => {
  assert.deepEqual(fillCandidates(section), [
    'my-gateway/thinker',
    'catalog-route/catalog-model',
    'catalog-route/other-model',
  ])
  assert.deepEqual(fillCandidates(undefined), [])
  assert.deepEqual(fillCandidates({}), [])
})

test('withDefaultEfforts fills exactly the target set (models[] and modelOverrides)', () => {
  const { next, filled } = withDefaultEfforts(section, {
    targets: ['my-gateway/thinker', 'catalog-route/other-model'],
  })
  assert.deepEqual(filled, ['my-gateway/thinker', 'catalog-route/other-model'])
  // pi-ai gate: off is null (never an empty string)
  assert.deepEqual(next.providers['my-gateway'].models[0].reasoningEfforts, { off: null, high: 'high', max: 'max' })
  assert.deepEqual(next.providers['catalog-route'].modelOverrides['other-model'].reasoningEfforts, { off: null, high: 'high', max: 'max' })
  assert.equal(next.providers['catalog-route'].modelOverrides['other-model'].name, 'Override')
  // compat flag added on the explicit openai-completions route only
  assert.equal(next.providers['my-gateway'].models[0].compat.supportsReasoningEffort, true)
  assert.equal(next.providers['catalog-route'].modelOverrides['other-model'].compat, undefined)
  // untouched
  assert.equal(next.providers['catalog-route'].models[0].reasoningEfforts, undefined)
  assert.equal(next.providers['my-gateway'].models[1].reasoningEfforts.high, 'ultra')
  assert.equal(next.providers['my-gateway'].models[2].reasoningEfforts, false)
  // input not mutated
  assert.equal(section.providers['my-gateway'].models[0].reasoningEfforts, undefined)
})

test('withDefaultEfforts: empty or unknown targets are identity-stable', () => {
  assert.equal(withDefaultEfforts(section, { targets: [] }).next, section)
  assert.equal(withDefaultEfforts(section, { targets: ['my-gateway/declared'] }).next, section)
  assert.equal(withDefaultEfforts(section, { targets: ['nope/nope'] }).next, section)
  assert.equal(withDefaultEfforts(undefined, { targets: ['a/b'] }).next, undefined)
})

test('withModelEfforts rewrites a models[] row by id (normalizing the wire values)', () => {
  const { next, changed, problems } = withModelEfforts(section, 'my-gateway', 'declared', { off: '', high: 'ultra', max: 'max' })
  assert.equal(changed, true)
  assert.deepEqual(problems, [])
  // empty string for off normalizes to null (pi-ai rejects empty strings)
  assert.deepEqual(next.providers['my-gateway'].models[1].reasoningEfforts, { off: null, high: 'ultra', max: 'max' })
  // the row already had a table, and the route is openai-completions: the
  // compat flag is added because the row did not declare it
  assert.equal(next.providers['my-gateway'].models[1].compat.supportsReasoningEffort, true)
  assert.equal(next.providers['my-gateway'].models[0].reasoningEfforts, undefined)
})

test('withModelEfforts rejects an invalid table with named problems', () => {
  const r = withModelEfforts(section, 'my-gateway', 'declared', { off: '' })
  assert.equal(r.changed, false)
  assert.ok(r.problems.length > 0)
  // a blank non-off wire value is dropped by normalization -> then invalid
  const r2 = withModelEfforts(section, 'my-gateway', 'declared', { off: '', high: '  ' })
  assert.equal(r2.changed, false)
})

test('withModelEfforts rewrites a modelOverrides entry by key (no compat on catalog routes)', () => {
  const s = { providers: { cat: { modelOverrides: { 'm-1': { name: 'M One' } } } } }
  const { next, changed } = withModelEfforts(s, 'cat', 'm-1', { high: 'high' })
  assert.equal(changed, true)
  assert.deepEqual(next.providers.cat.modelOverrides['m-1'].reasoningEfforts, { high: 'high' })
  assert.equal(next.providers.cat.modelOverrides['m-1'].name, 'M One')
  assert.equal(next.providers.cat.modelOverrides['m-1'].compat, undefined)
})

test('withModelEfforts: unknown row is a no-op', () => {
  const { next, changed } = withModelEfforts(section, 'my-gateway', 'nope', { high: 'high' })
  assert.equal(changed, false)
  assert.equal(next, section)
})
