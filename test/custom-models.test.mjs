/**
 * custom-models.js unit tests — candidate scan, gated fill, per-model edits.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EFFORT_TABLE,
  fillCandidates,
  isCustomGateway,
  withDefaultEfforts,
  withModelEfforts,
} from '../lib/custom-models.js'

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
  assert.deepEqual(next.providers['my-gateway'].models[0].reasoningEfforts, { ...DEFAULT_EFFORT_TABLE })
  assert.deepEqual(next.providers['catalog-route'].modelOverrides['other-model'].reasoningEfforts, { ...DEFAULT_EFFORT_TABLE })
  assert.equal(next.providers['catalog-route'].modelOverrides['other-model'].name, 'Override')
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

test('withModelEfforts rewrites a models[] row by id', () => {
  const { next, changed } = withModelEfforts(section, 'my-gateway', 'declared', { off: '', high: 'ultra', max: 'max' })
  assert.equal(changed, true)
  assert.deepEqual(next.providers['my-gateway'].models[1].reasoningEfforts, { off: '', high: 'ultra', max: 'max' })
  assert.equal(next.providers['my-gateway'].models[0].reasoningEfforts, undefined)
})

test('withModelEfforts rewrites a modelOverrides entry by key', () => {
  const s = { providers: { cat: { modelOverrides: { 'm-1': { name: 'M One' } } } } }
  const { next, changed } = withModelEfforts(s, 'cat', 'm-1', { high: 'high' })
  assert.equal(changed, true)
  assert.deepEqual(next.providers.cat.modelOverrides['m-1'].reasoningEfforts, { high: 'high' })
  assert.equal(next.providers.cat.modelOverrides['m-1'].name, 'M One')
})

test('withModelEfforts: unknown row is a no-op', () => {
  const { next, changed } = withModelEfforts(section, 'my-gateway', 'nope', { high: 'high' })
  assert.equal(changed, false)
  assert.equal(next, section)
})
