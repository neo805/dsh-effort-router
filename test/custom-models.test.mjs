/**
 * custom-models.js unit tests — candidate scan and gated fill. (The per-model
 * editor and its helpers were removed in 0.2.7-rc.6 with the settings card:
 * per-model tables are now edited directly in the llm-pi-ai config.)
 *
 * 0.2.10: the 0.2.1 Models page can declare reasoningEfforts per model in the
 * UI; the fill now reads candidates from the PROFILE (base) layer and never
 * touches a row the settings user layer owns (the page's switch stores OFF by
 * removing the field). userOwnsModel + planFill cover that split.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EFFORT_TABLE,
  fillCandidates,
  planFill,
  userOwnsModel,
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

// ---- 0.2.1 user-layer ownership + planFill ------------------------------------

test('userOwnsModel: the settings user layer claims models[] and modelOverrides rows', () => {
  const user = {
    providers: {
      'my-gateway': {
        models: [{ id: 'thinker' }],             // switch OFF: field absent, row present
        modelOverrides: { extra: { name: 'x' } }, // same for overrides
      },
    },
  }
  assert.equal(userOwnsModel(user, 'my-gateway/thinker'), true)
  assert.equal(userOwnsModel(user, 'my-gateway/extra'), true)
  assert.equal(userOwnsModel(user, 'my-gateway/plain'), false)
  assert.equal(userOwnsModel({}, 'my-gateway/thinker'), false)
  assert.equal(userOwnsModel(undefined, 'a/b'), false)
})

test('planFill: fills only base-layer rows and never undoes a UI switch OFF', () => {
  const base = {
    providers: {
      'my-gateway': {
        api: 'openai-completions',
        models: [{ id: 'thinker' }, { id: 'turned-off' }],
        modelOverrides: { extra: { name: 'gateway extra' } },
      },
    },
  }
  // The user layer owns 'turned-off' (switch OFF removed the field) and the
  // override row; 'thinker' was never touched in the UI.
  const user = {
    providers: {
      'my-gateway': {
        models: [{ id: 'turned-off', name: 'keep me' }],
        modelOverrides: { extra: { name: 'user renamed' } },
      },
    },
  }
  const { providers, filled } = planFill(base, user, ['my-gateway/thinker'])
  assert.deepEqual(filled, ['my-gateway/thinker'])
  const models = providers['my-gateway'].models
  // The user list wins (merge semantics replace arrays), the owned row keeps
  // its shape, and the filled row carries the default table + compat flag.
  assert.deepEqual(models.map((row) => row.id), ['turned-off', 'thinker'])
  assert.equal(models[0].reasoningEfforts, undefined, 'switch OFF stays off')
  assert.deepEqual(models[1].reasoningEfforts, DEFAULT_EFFORT_TABLE)
  assert.equal(models[1].compat.supportsReasoningEffort, true)
  // The untouched override row is not in the write (the user layer keeps its copy).
  assert.equal(providers['my-gateway'].modelOverrides, undefined)
})

test('planFill: empty targets and unknown models are identity-stable', () => {
  const base = { providers: { r: { models: [{ id: 'm' }] } } }
  assert.deepEqual(planFill(base, {}, []), { providers: null, filled: [] })
  assert.deepEqual(planFill(base, {}, ['r/nope']), { providers: null, filled: [] })
  assert.deepEqual(planFill(undefined, {}, ['r/m']), { providers: null, filled: [] })
})

test('planFill: fills modelOverrides from the base layer when the user has none', () => {
  const base = { providers: { r: { modelOverrides: { extra: { name: 'gateway extra' } } } } }
  const { providers, filled } = planFill(base, {}, ['r/extra'])
  assert.deepEqual(filled, ['r/extra'])
  assert.deepEqual(providers.r.modelOverrides.extra.reasoningEfforts, DEFAULT_EFFORT_TABLE)
  assert.equal(providers.r.modelOverrides.extra.name, 'gateway extra')
})
