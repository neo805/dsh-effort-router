import '../test-profile.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadApplyForRuntime } from '../helpers/host-0.2.2-harness.mjs'

const ENGINEERING = '设计并实现一个支持高并发、幂等写入和故障恢复的分布式事务系统'

async function verifyLegacy(runtime) {
  const entry = await loadApplyForRuntime(runtime)
  const listeners = new Map()
  const effects = []
  let selected = 0
  let appended = 0
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] } }
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
  entry.apply(ctx, entry.Config({}))
  const agent = {
    sessionId: `f01-legacy-single-path-${runtime}`,
    session: {
      header: {},
      deriveMessages: () => [{ role: 'user', content: ENGINEERING }],
      append() { appended += 1 },
      requestHeader: () => ({}),
    },
    model: {
      current: () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }),
      select() { selected += 1 },
    },
  }
  let next = async () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  for (const handler of [...listeners.get('agent/request')].reverse()) {
    const downstream = next
    next = (current) => handler(current, downstream)
  }
  const result = await next({ agent, turn: 1, step: 1 })
  assert.equal(result.reasoningEffort, 'high')
  assert.equal(selected, 0, `${runtime} must not use the 0.2.2 selection writer`)
  assert.equal(appended <= 1, true, 'at most the existing logical-Auto witness is appended')
  for (const off of effects.reverse()) off()
}

test('F01-16 tested 0.2.1 runtimes keep request interception single-path even if select is present', async () => {
  // rc.2 is the installed Desktop baseline; rc.5 is the researched 0.2.1
  // compatibility target. Neither is mislabeled as an untested stable 0.2.1.
  for (const runtime of ['0.2.1-rc.2', '0.2.1-rc.5']) await verifyLegacy(runtime)
})
