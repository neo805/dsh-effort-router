import '../test-profile.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadApplyForRuntime, setTestRuntimeVersion } from '../helpers/host-0.2.2-harness.mjs'

const ENGINEERING = '设计并实现一个支持高并发、幂等写入和故障恢复的分布式事务系统'
const legacyEntries = new Map(await Promise.all(
  ['0.2.1-rc.2', '0.2.1-rc.5'].map(async (runtime) => [runtime, await loadApplyForRuntime(runtime)]),
))

async function verifyLegacy(runtime, options = {}) {
  const entry = legacyEntries.get(runtime)
  setTestRuntimeVersion(runtime)
  const listeners = new Map()
  const effects = []
  let selected = 0
  let appended = 0
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: (options.levels ?? ['low', 'high', 'max']).map((id) => ({ id })) } }
    },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'sessionProjections') return { stateOf: () => null, cachedSnapshot: () => null, register: () => () => {} }
      throw new Error('no service ' + name)
    },
    on(event, fn, registration = {}) {
      const list = listeners.get(event) ?? []
      if (registration.prepend) list.unshift(fn)
      else list.push(fn)
      listeners.set(event, list)
      return () => {}
    },
    inject() {},
    effect(fn) { const off = fn(); if (off) effects.push(off); return () => {} },
  }
  entry.apply(ctx, entry.Config(options.config ?? {}))
  let currentEffort = 'auto'
  const agent = {
    sessionId: `f01-legacy-${options.id ?? 'single-path'}-${runtime}`,
    session: {
      header: {},
      deriveMessages: () => [{ role: 'user', content: ENGINEERING }],
      append() { appended += 1 },
      requestHeader: () => ({}),
    },
    model: {
      current: () => ({ provider: 'gw', model: 'thinker', reasoningEffort: currentEffort }),
      select() { selected += 1 },
    },
  }
  let next = async () => ({ provider: 'gw', model: 'thinker', reasoningEffort: currentEffort })
  for (const handler of [...listeners.get('agent/request')].reverse()) {
    const downstream = next
    next = (current) => handler(current, downstream)
  }
  const sequence = options.sequence ?? [{ expected: options.expected ?? 'high' }]
  let autoRequests = 0
  for (const [index, step] of sequence.entries()) {
    currentEffort = step.effort ?? 'auto'
    if (currentEffort === 'auto') autoRequests += 1
    const result = await next({ agent, turn: step.turn ?? 1, step: step.step ?? index + 1 })
    assert.equal(result.reasoningEffort, step.expected, `${runtime} sequence step ${index + 1}`)
  }
  assert.equal(selected, 0, `${runtime} must not use the 0.2.2 selection writer`)
  assert.equal(appended <= autoRequests, true, 'at most one existing logical-Auto witness per Auto request')
  for (const off of effects.reverse()) off()
}

test('F01-16 tested 0.2.1 runtimes keep request interception single-path even if select is present', async () => {
  // rc.2 is the installed Desktop baseline; rc.5 is the researched 0.2.1
  // compatibility target. Neither is mislabeled as an untested stable 0.2.1.
  for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.5']) await verifyLegacy(runtime)
})

const interpolatedLevels = ['low', 'vendor-3', 'vendor-4', 'vendor-5', 'max']

test('F01-19 legacy consecutive Auto steps preserve direct manual takeover and later Auto', async () => {
  for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.5']) {
    await verifyLegacy(runtime, {
      id: 'multi-step-manual-ownership',
      sequence: [
        { turn: 1, step: 1, effort: 'auto', expected: 'high' },
        { turn: 1, step: 2, effort: 'max', expected: 'max' },
        { turn: 2, step: 1, effort: 'max', expected: 'max' },
        { turn: 3, step: 1, effort: 'auto', expected: 'high' },
      ],
    })
  }
})

test('F01-20 legacy omits a manual effort the current model cannot express', async () => {
  for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.5']) {
    await verifyLegacy(runtime, {
      id: 'manual-unsupported',
      levels: ['low'],
      sequence: [
        { turn: 1, step: 1, effort: 'max', expected: undefined },
        { turn: 1, step: 2, effort: 'max', expected: undefined },
      ],
    })
  }
})

test('F01-17 legacy explicit allowedEfforts also filters final ids, not interpolated ranks', async () => {
  for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.5']) {
    await verifyLegacy(runtime, {
      id: 'allow-final-ids',
      levels: interpolatedLevels,
      config: { allowedEfforts: ['medium', 'max'] },
      expected: 'max',
    })
  }
})

test('F01-18 migrated allowMax remains a rank ceiling for unknown advertised ids', async () => {
  for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.5']) {
    await verifyLegacy(runtime, {
      id: 'legacy-rank-ceiling',
      levels: interpolatedLevels,
      config: { allowMax: false, maxFallback: 'high' },
      expected: 'vendor-4',
    })
  }
})
