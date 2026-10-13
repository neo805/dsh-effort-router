/**
 * custom-models.js unit tests — candidate scan and gated fill. (The per-model
 * editor and its helpers were removed in 0.2.7-rc.6 with the settings card:
 * per-model tables are now edited directly in the llm-pi-ai config.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EFFORT_TABLE,
  fillCandidates,
  withDefaultEfforts,
} from '../lib/custom-models.js'

test('DEFAULT_EFFORT_TABLE matches the pi-ai gate shape (low/high/max, no off rung)', () => {
  assert.deepEqual(DEFAULT_EFFORT_TABLE, { low: 'low', high: 'high', max: 'max' })
  assert.equal('off' in DEFAULT_EFFORT_TABLE, false)
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
  // 0.2.0 default table: low/high/max, no off rung (thinking stays on)
  assert.deepEqual(next.providers['my-gateway'].models[0].reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
  assert.deepEqual(next.providers['catalog-route'].modelOverrides['other-model'].reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
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
