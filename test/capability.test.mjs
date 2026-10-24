/**
 * capability.js tests — the Auto-mask advertisement (the plugin's core client
 * mechanism) and the per-model capability cache. advertiseAutoMask had zero
 * test hits until the cleanup pass, so a host change to the adapter contract
 * would only have shown up in the field.
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
  const shared = { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } }
  const { llm, resolve } = fakeLlm({ 'gw/thinker': shared })
  const registration = advertiseAutoMask(llm, { info() {} })
  assert.equal(registration.count, 1)
  const info = await resolve('gw', 'thinker')
  assert.deepEqual(info.reasoning.efforts.map((e) => e.id), ['off', 'low', 'high', 'auto'])
  assert.deepEqual(info.reasoning.efforts[3], AUTO_EFFORT)
  // The adapter's cached info object is not mutated in place.
  assert.deepEqual(shared.reasoning.efforts.map((e) => e.id), ['off', 'low', 'high'])
  assert.notEqual(info, shared)
  registration.dispose()
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
  const first = advertiseAutoMask(llm, { info: (m) => logs.push(m) })
  const second = advertiseAutoMask(llm, { info: (m) => logs.push(m) })
  assert.equal(first.count, 1)
  assert.equal(second.count, 0, 'already wrapped')
  const efforts = (await resolve('gw', 'thinker')).reasoning.efforts
  assert.deepEqual(efforts.map((e) => e.id), ['low', 'auto'], 'auto added once')
  assert.equal(logs.length, 1, 'the advertisement is logged exactly once')
  assert.match(logs[0], /auto mask advertised on 1 adapter/)
  // The wrapper delegates to the adapter's own resolveModel (no second hop).
  assert.equal(typeof adapter.resolveModel, 'function')
  first.dispose()
  second.dispose()
})

test('advertiseAutoMask: a host without adapters is a no-op, never a throw', () => {
  assert.equal(advertiseAutoMask(undefined, { info() {} }).count, 0)
  assert.equal(advertiseAutoMask({}, { info() {} }).count, 0)
  assert.equal(advertiseAutoMask({ adapters: new Map() }, { info() {} }).count, 0)
  // An adapter that cannot resolve models is left alone.
  assert.equal(advertiseAutoMask({ adapters: new Map([['a', { adapter: {} }]]) }, { info() {} }).count, 0)
})

test('advertiseAutoMask: dispose restores exactly once and never clobbers a later wrapper', async () => {
  const { llm, adapter, resolve } = fakeLlm({
    'gw/thinker': { reasoning: { efforts: [{ id: 'low' }] } },
  })
  const original = adapter.resolveModel
  const registration = advertiseAutoMask(llm, { info() {} })
  registration.dispose()
  assert.equal(adapter.resolveModel, original, 'the original function is restored by identity')
  assert.deepEqual((await resolve('gw', 'thinker')).reasoning.efforts, [{ id: 'low' }])
  registration.dispose() // idempotent
  assert.equal(adapter.resolveModel, original)

  // A third party wraps after us; our late dispose must not clobber it.
  advertiseAutoMask(llm, { info() {} })
  const ours = adapter.resolveModel
  const thirdParty = async () => ({ reasoning: { efforts: [{ id: 'third' }] } })
  adapter.resolveModel = thirdParty
  assert.notEqual(adapter.resolveModel, ours)
  // The stale registration's disposer only acts when its wrapper is current.
  const stale = advertiseAutoMask(llm, { info() {} })
  stale.dispose()
  assert.equal(adapter.resolveModel, thirdParty)
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

test('createCapabilityResolver: a resolution failure degrades without poisoning the cache', async () => {
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
  assert.equal(calls, 2, 'a transient failure is retried, not cached for the process lifetime')
  // Malformed arguments short-circuit without touching the llm service.
  assert.deepEqual(await capability.resolve(undefined, 'm'), UNRESOLVABLE_CAPABILITY)
  assert.deepEqual(await capability.resolve('gw', 42), UNRESOLVABLE_CAPABILITY)
})

test('createCapabilityResolver: a stale pre-clear resolve never overwrites the new generation', async () => {
  let releaseOld
  const oldGate = new Promise((resolve) => { releaseOld = resolve })
  let calls = 0
  const llm = {
    async resolveModelInfo() {
      calls += 1
      if (calls === 1) await oldGate
      return { reasoning: { efforts: calls === 1 ? [{ id: 'low' }] : [{ id: 'high' }] } }
    },
  }
  const capability = createCapabilityResolver({ llm: () => llm })
  const old = capability.resolve('gw', 'm')
  capability.clear()
  const fresh = await capability.resolve('gw', 'm')
  assert.deepEqual(fresh.efforts, ['high'])
  releaseOld()
  await old
  const after = await capability.resolve('gw', 'm')
  assert.deepEqual(after.efforts, ['high'], 'the old generation does not repopulate the cache')
  assert.equal(calls, 2)
})

test('createCapabilityResolver: concurrent misses share one resolution', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const llm = {
    async resolveModelInfo() {
      calls += 1
      await gate
      return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }
    },
  }
  const capability = createCapabilityResolver({ llm: () => llm })
  const first = capability.resolve('gw', 'm')
  const second = capability.resolve('gw', 'm')
  await new Promise((resolve) => setImmediate(resolve))
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls, 1, 'a cache miss is single-flight per key')
  assert.equal(a, b, 'both callers share the resolved capability object')
})
