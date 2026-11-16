import '../test-profile.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createModernHost,
  loadApplyForRuntime,
  setTestRuntimeVersion,
  userMessage,
} from '../helpers/host-0.2.2-harness.mjs'

const modernEntry = await loadApplyForRuntime('0.2.2-rc.3')
const legacyEntry = await loadApplyForRuntime('0.2.1-rc.5')
setTestRuntimeVersion('0.2.2-rc.3')

const ENGINEERING = '设计并实现一个支持高并发、幂等写入和故障恢复的分布式事务系统'
const selection = (reasoningEffort, overrides = {}) => ({
  provider: 'gw', model: 'thinker', reasoningEffort, ...overrides,
})
const nativeDefaults = (reasoningEffort, overrides = {}) => selection(reasoningEffort, overrides)

function nativeHost(t, defaults, config = {}, entry = modernEntry, hostOptions = {}) {
  const runtime = entry === legacyEntry ? '0.2.1-rc.5' : '0.2.2-rc.3'
  setTestRuntimeVersion(runtime)
  const host = createModernHost({
    apply: entry.apply,
    config: entry.Config(config),
    nativeDefaults: defaults,
    ...hostOptions,
  })
  t.after(() => host.dispose())
  return { host, runtime }
}

async function nativeAgent(host, runtime, id, options = {}) {
  const created = host.createAgent(id, options)
  if (runtime === '0.2.2-rc.3') await host.announceAgent(created.agent)
  return created
}

async function runNative(host, runtime, agent, turn = 1) {
  if (runtime === '0.2.2-rc.3') {
    return host.runStep(agent, { turn, step: 1, claimed: [userMessage(ENGINEERING)] })
  }
  agent.session.messages.push(userMessage(ENGINEERING))
  const config = await host.waterfall(
    'agent/request',
    { agent, turn, step: 1 },
    async () => agent.model.current(),
  )
  return { config }
}

for (const [label, entry] of [['modern', modernEntry], ['legacy', legacyEntry]]) {
  test(`G02 ${label} native global Auto and concrete defaults survive new Agents and restart`, async (t) => {
    for (const effort of ['auto', 'max']) {
      const defaults = nativeDefaults(effort)
      const first = nativeHost(t, defaults, {}, entry)
      if (effort === 'auto' && entry === modernEntry) await first.host.primeCapability()
      const initial = await nativeAgent(first.host, first.runtime, `g02-${label}-${effort}-initial`)
      assert.equal(initial.agent.model.current().reasoningEffort, effort)
      const result = await runNative(first.host, first.runtime, initial.agent)
      assert.equal(result.config.reasoningEffort, effort === 'auto' ? 'high' : 'max')
      assert.deepEqual(first.host.defaultSelection(), defaults)
      first.host.dispose()

      const restarted = nativeHost(t, defaults, {}, entry)
      const next = await nativeAgent(restarted.host, restarted.runtime, `g02-${label}-${effort}-next`)
      assert.equal(next.agent.model.current().reasoningEffort, effort)
      assert.deepEqual(restarted.host.defaultSelection(), defaults)
    }
  })
}

test('G02 native default is one latest global selection, not a per-provider/model memory map', async (t) => {
  const defaults = nativeDefaults('low')
  const { host, runtime } = nativeHost(t, defaults)
  host.selectModel(selection('max', { provider: 'other', model: 'shared' }))
  const other = await nativeAgent(host, runtime, 'g02-global-other')
  assert.equal(other.agent.model.current().provider, 'other')
  assert.equal(other.agent.model.current().reasoningEffort, 'max')

  host.selectModel(selection('low', { provider: 'gw', model: 'shared' }))
  host.selectModel(selection('high', { provider: 'other', model: 'shared' }))
  const back = await nativeAgent(host, runtime, 'g02-global-latest')
  assert.equal(back.agent.model.current().provider, 'other')
  assert.equal(back.agent.model.current().reasoningEffort, 'high', 'the latest global choice wins; no old route bucket is resurrected')
})

test('G02 rc3 live option getters observe a native global default switch', async (t) => {
  const defaults = nativeDefaults('low')
  const { host, runtime } = nativeHost(t, defaults)
  const created = await nativeAgent(host, runtime, 'g02-live-options')
  assert.equal(created.agent.model.current().reasoningEffort, 'low')
  host.selectModel(selection('max'))
  assert.equal(created.agent.options.reasoningEffort, 'max')
  assert.equal(created.agent.model.current().reasoningEffort, 'max')
  const result = await runNative(host, runtime, created.agent)
  assert.equal(result.config.reasoningEffort, 'max')
})

test('G02 an explicit per-Agent concrete choice does not rewrite the native global default', async (t) => {
  const defaults = nativeDefaults('low')
  const { host, runtime } = nativeHost(t, defaults)
  const manual = await nativeAgent(host, runtime, 'g02-explicit-agent', { effort: 'max' })
  const result = await runNative(host, runtime, manual.agent)
  assert.equal(result.config.reasoningEffort, 'max')
  assert.deepEqual(host.defaultSelection(), defaults)
  const next = await nativeAgent(host, runtime, 'g02-after-explicit-agent')
  assert.equal(next.agent.model.current().reasoningEffort, 'low')
})

test('G02 automatic concrete output never replaces the native logical Auto default', async (t) => {
  const defaults = nativeDefaults('auto')
  const { host, runtime } = nativeHost(t, defaults)
  await host.primeCapability()
  const first = await nativeAgent(host, runtime, 'g02-auto-output-first')
  const result = await runNative(host, runtime, first.agent)
  assert.equal(result.config.reasoningEffort, 'high')
  assert.deepEqual(host.defaultSelection(), defaults)
  const second = await nativeAgent(host, runtime, 'g02-auto-output-second')
  assert.equal(second.agent.model.current().reasoningEffort, 'auto')
  assert.equal(second.agent.model.current().reasoningEffort === 'high', false)
})

test('G02 a manual decision record cannot be reverse-engineered into a native preference', async (t) => {
  const defaults = nativeDefaults('auto')
  const first = nativeHost(t, defaults)
  const manual = await nativeAgent(first.host, first.runtime, 'g02-no-reverse-preference', { effort: 'max' })
  await runNative(first.host, first.runtime, manual.agent)
  assert.deepEqual(first.host.defaultSelection(), defaults)
  first.host.dispose()

  const restarted = nativeHost(t, defaults)
  const next = await nativeAgent(restarted.host, restarted.runtime, 'g02-no-reverse-preference-next')
  assert.equal(next.agent.model.current().reasoningEffort, 'auto')
})

test('G02 configured defaultLevel is used only when the native default has no effort', async (t) => {
  const defaults = nativeDefaults(undefined)
  const { host, runtime } = nativeHost(t, defaults, { defaultLevel: 'high' })
  await host.primeCapability()
  const created = await nativeAgent(host, runtime, 'g02-default-level')
  assert.equal(created.agent.model.current().reasoningEffort, undefined)
  const result = await runNative(host, runtime, created.agent)
  assert.equal(result.config.reasoningEffort, 'high')
  assert.deepEqual(host.defaultSelection(), { provider: 'gw', model: 'thinker' })
})

test('G02 unsupported native concrete effort falls back safely without nearest-level guessing', async (t) => {
  const defaults = nativeDefaults('max')
  const llm = { adapters: new Map(), async resolveModelInfo() { return { reasoning: null } } }
  const { host, runtime } = nativeHost(t, defaults, {}, modernEntry, { llm })
  await host.primeCapability()
  const created = await nativeAgent(host, runtime, 'g02-unsupported-native')
  const result = await runNative(host, runtime, created.agent)
  assert.equal(result.config.reasoningEffort, undefined)
  assert.equal(created.agent.model.current().reasoningEffort, 'max')
  assert.deepEqual(host.defaultSelection(), defaults)
})

test('G02 explicit subagent inheritance outranks the native global default without polluting it', async (t) => {
  const defaults = nativeDefaults('low')
  const { host, runtime } = nativeHost(t, defaults)
  const parent = await nativeAgent(host, runtime, 'g02-native-parent', { effort: 'max' })
  await runNative(host, runtime, parent.agent)
  const child = await nativeAgent(host, runtime, 'g02-native-child', {
    effort: 'max',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await runNative(host, runtime, child.agent, 2)
  assert.equal(result.config.reasoningEffort, 'max')
  assert.deepEqual(host.defaultSelection(), defaults)
})

test('G02 disabled plugin omits private Auto without mutating the native global default', async (t) => {
  const defaults = nativeDefaults('auto')
  const { host, runtime } = nativeHost(t, defaults, { enabled: false })
  const created = await nativeAgent(host, runtime, 'g02-disabled-native-auto')
  const result = await runNative(host, runtime, created.agent)
  assert.equal(result.config.reasoningEffort, undefined)
  assert.deepEqual(host.defaultSelection(), defaults)
  const next = await nativeAgent(host, runtime, 'g02-disabled-native-auto-next')
  assert.equal(next.agent.model.current().reasoningEffort, 'auto')
})

test('G02 independent native default stores cannot leak across profiles', async (t) => {
  const defaultsA = nativeDefaults('max')
  const defaultsB = nativeDefaults('low')
  const a = nativeHost(t, defaultsA)
  const b = nativeHost(t, defaultsB)
  const agentA = await nativeAgent(a.host, a.runtime, 'g02-profile-a')
  const agentB = await nativeAgent(b.host, b.runtime, 'g02-profile-b')
  assert.equal(agentA.agent.model.current().reasoningEffort, 'max')
  assert.equal(agentB.agent.model.current().reasoningEffort, 'low')
  a.host.selectModel(selection('high'))
  assert.equal(b.host.defaultSelection().reasoningEffort, 'low')
})
