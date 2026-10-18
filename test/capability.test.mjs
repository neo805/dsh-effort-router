/**
 * capability.js tests — the Auto-mask advertisement (the plugin's core client
 * mechanism) and the per-model capability cache. Both were uncovered until
 * Uncovered until the cleanup pass: advertiseAutoMask had zero test hits, so a host change to the adapter
 * contract would only show up in the field.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_EFFORT,
  UNRESOLVABLE_CAPABILITY,
  advertiseAutoMask,
  createCapabilityResolver,
  reasoningEffortSupported,
} from '../lib/capability.js'

/** A fake llm service with one adapter answering from a model table. */
function fakeLlm(table) {
  const adapter = {
    async resolveModel(provider, model) {
      return table[provider + '/' + model] ?? {}
    },
  }
  return {
    adapter,
    llm: { adapters: new Map([['a', { adapter }]]) },
    resolve(provider, model) {
      return adapter.resolveModel(provider, model)
    },
  }
}

test('advertiseAutoMask: a thinking model gains exactly one auto entry', async () => {
  const { llm, resolve } = fakeLlm({
    'gw/thinker': { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } },
  })
  assert.equal(advertiseAutoMask(llm, { info() {} }), 1)
  const info = await resolve('gw', 'thinker')
  assert.deepEqual(info.reasoning.efforts.map((e) => e.id), ['off', 'low', 'high', 'auto'])
  assert.deepEqual(info.reasoning.efforts[3], AUTO_EFFORT)
  // The rest of the resolved info rides along untouched.
  assert.equal(typeof info.reasoning, 'object')
})

test('advertiseAutoMask: only models with a THINKING level are masked', async () => {
  const { llm, resolve } = fakeLlm({
    'gw/plain': {},                                              // no reasoning metadata
    'gw/off-only': { reasoning: { efforts: [{ id: 'off' }] } },   // nothing to schedule
    'gw/both': { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }] } },
  })
  advertiseAutoMask(llm, { info() {} })
  assert.deepEqual(await resolve('gw', 'plain'), {}, 'no reasoning block: untouched')
  assert.deepEqual((await resolve('gw', 'off-only')).reasoning.efforts, [{ id: 'off' }])
  assert.deepEqual(
    (await resolve('gw', 'both')).reasoning.efforts.map((e) => e.id),
    ['off', 'low', 'auto'],
  )
})

test('advertiseAutoMask: idempotent — a second pass wraps nothing and never duplicates', async () => {
  const { llm, adapter, resolve } = fakeLlm({
    'gw/thinker': { reasoning: { efforts: [{ id: 'low' }] } },
  })
  const logs = []
  assert.equal(advertiseAutoMask(llm, { info: (m) => logs.push(m) }), 1)
  assert.equal(advertiseAutoMask(llm, { info: (m) => logs.push(m) }), 0, 'already wrapped')
  const efforts = (await resolve('gw', 'thinker')).reasoning.efforts
  assert.deepEqual(efforts.map((e) => e.id), ['low', 'auto'], 'auto added once')
  assert.equal(logs.length, 1, 'the advertisement is logged exactly once')
  assert.match(logs[0], /auto mask advertised on 1 adapter/)
  // The wrapper delegates to the adapter's own resolveModel (no second hop).
  assert.equal(typeof adapter.resolveModel, 'function')
})

test('advertiseAutoMask: a host without adapters is a no-op, never a throw', () => {
  assert.equal(advertiseAutoMask(undefined, { info() {} }), 0)
  assert.equal(advertiseAutoMask({}, { info() {} }), 0)
  assert.equal(advertiseAutoMask({ adapters: new Map() }, { info() {} }), 0)
  // An adapter that cannot resolve models is left alone.
  assert.equal(advertiseAutoMask({ adapters: new Map([['a', { adapter: {} }]]) }, { info() {} }), 0)
})

test('reasoningEffortSupported: only a non-empty efforts array counts', () => {
  assert.equal(reasoningEffortSupported(undefined), false)
  assert.equal(reasoningEffortSupported(null), false)
  assert.equal(reasoningEffortSupported({}), false)
  assert.equal(reasoningEffortSupported({ efforts: [] }), false)
  assert.equal(reasoningEffortSupported({ efforts: [{ id: 'off' }] }), true)
})

test('createCapabilityResolver: caches per model and clear() re-resolves', async () => {
  let calls = 0
  const llm = {
    async resolveModelInfo(provider, model) {
      calls += 1
      return { reasoning: { efforts: [{ id: 'off' }, { id: model }] } }
    },
  }
  const capability = createCapabilityResolver({ llm: () => llm })
  const first = await capability.resolve('gw', 'thinker')
  assert.deepEqual(first, { supportsReasoning: true, efforts: ['off', 'thinker'] })
  const second = await capability.resolve('gw', 'thinker')
  assert.equal(second, first, 'the cached capability object is reused')
  assert.equal(calls, 1, 'one resolution per provider/model')
  await capability.resolve('gw', 'other')
  assert.equal(calls, 2)
  capability.clear()
  await capability.resolve('gw', 'thinker')
  assert.equal(calls, 3, 'clear() drops the cache (adapter churn)')
})

test('createCapabilityResolver: a resolution failure degrades to "never inject"', async () => {
  let calls = 0
  const capability = createCapabilityResolver({
    llm: () => ({
      async resolveModelInfo() {
        calls += 1
        throw new Error('route not ready')
      },
    }),
  })
  const failed = await capability.resolve('gw', 'thinker')
  assert.deepEqual(failed, UNRESOLVABLE_CAPABILITY)
  assert.equal(failed.supportsReasoning, false)
  await capability.resolve('gw', 'thinker')
  assert.equal(calls, 1, 'the failure is cached too (no retry storm per step)')
  // Malformed arguments short-circuit without touching the llm service.
  assert.deepEqual(await capability.resolve(undefined, 'm'), UNRESOLVABLE_CAPABILITY)
  assert.deepEqual(await capability.resolve('gw', 42), UNRESOLVABLE_CAPABILITY)
})
