import './test-profile.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ENGINEERING,
  TRIVIAL,
  createModernHost,
  loadApplyForRuntime,
  setTestRuntimeVersion,
  toolResult,
  userMessage,
} from './helpers/host-0.2.2-harness.mjs'

const entry = await loadApplyForRuntime('0.2.2-rc.3')
const settle = () => new Promise((resolve) => setImmediate(resolve))
const nativeAuto = () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
const nativeEffort = (reasoningEffort) => ({ provider: 'gw', model: 'thinker', reasoningEffort })

function modern(t, config = {}, hostOptions = {}) {
  setTestRuntimeVersion('0.2.2-rc.3')
  const host = createModernHost({
    apply: entry.apply,
    config: entry.Config(config),
    ...hostOptions,
  })
  t.after(() => host.dispose())
  return host
}

async function autoModern(t, config = {}, hostOptions = {}) {
  const host = modern(t, config, hostOptions)
  await host.primeCapability()
  return host
}

async function announced(host, ...args) {
  const created = host.createAgent(...args)
  await host.announceAgent(created.agent)
  return created
}

function countSelects(agent) {
  const select = agent.model.select
  const calls = []
  agent.model.select = function countedSelect(next) {
    calls.push(next)
    return select.call(this, next)
  }
  return calls
}

test('NEXT FR-041: a same-step native Auto to manual change invalidates only the stale capture', async (t) => {
  const host = await autoModern(t)
  const { agent } = host.createAgent('next-current-manual-takeover', {
    effort: 'auto', pending: nativeAuto(),
  })
  await host.announceAgent(agent)
  agent.session.append('turn/start', { turn: 1 })
  await host.emit('agent/inbox/claimed', { agent, message: userMessage(ENGINEERING), turn: 1 })

  const first = agent.model.current()
  assert.equal(first.reasoningEffort, 'high')
  assert.deepEqual(agent.model.current(), first, 'an unchanged raw selection reuses the capture')

  agent.model.select(nativeEffort('max'))
  assert.equal(host.rawCurrent(agent).reasoningEffort, 'max')
  assert.equal(agent.model.current().reasoningEffort, 'max',
    'the cached Auto capture must not hide a newer explicit native selection')
  assert.equal(host.logs.filter((line) => line.includes(agent.id) && line.includes('rank ')).length, 1,
    'manual takeover must not schedule a second time in the same step')
})

test('NEXT FR-044/073: replacement concrete state cannot borrow the old generation Auto witness', async (t) => {
  const host = await autoModern(t)
  const id = 'next-replacement-manual'
  const original = await announced(host, id)
  const automatic = await host.runStep(original.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(automatic.config.reasoningEffort, 'low')

  const replacement = await announced(host, id, {
    effort: 'low',
    pending: null,
    lastUsed: nativeEffort('low'),
  })
  const manual = await host.runStep(replacement.agent, {
    turn: 2, step: 1, claimed: [userMessage(ENGINEERING)],
  })
  assert.equal(manual.config.reasoningEffort, 'low',
    'the old Auto decision belongs to the replaced generation, not this concrete native selection')
  assert.equal(replacement.agent.model.current().reasoningEffort, 'low')
  assert.equal(replacement.selectionEvents.length, 0)
})

test('NEXT FR-073/074: a fixed default stays fixed across consecutive turns', async (t) => {
  const host = await autoModern(t, { defaultLevel: 'high' })
  const { agent } = await announced(host, 'next-fixed-default-two-turns', { effort: undefined })
  const first = await host.runStep(agent, { claimed: [userMessage(TRIVIAL)] })
  const second = await host.runStep(agent, { turn: 2, claimed: [userMessage(TRIVIAL)] })
  assert.equal(first.config.reasoningEffort, 'high')
  assert.equal(second.config.reasoningEffort, 'high',
    'the previous fixed capture is not proof that the new turn is logical Auto')
  assert.equal(host.logs.filter((line) => line.includes(agent.id) && line.includes('rank ')).length, 0)
})

test('NEXT FR-076: a fixed default never writes native model/selection state', async (t) => {
  const host = await autoModern(t, { defaultLevel: 'high' })
  const created = host.createAgent('next-fixed-default-no-native-write', { effort: undefined })
  const selectCalls = countSelects(created.agent)
  await host.announceAgent(created.agent)
  const result = await host.runStep(created.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(result.config.reasoningEffort, 'high')
  assert.equal(selectCalls.length, 0, 'the fixed default belongs to capture, not native selection memory')
  assert.equal(created.selectionEvents.length, 0)
})

test('NEXT FR-040/076: missing native selection plus default Auto has no turn-end Auto restoration', async (t) => {
  const host = await autoModern(t, { defaultLevel: 'auto' })
  const created = host.createAgent('next-default-auto-no-native-write', { effort: undefined })
  const selectCalls = countSelects(created.agent)
  await host.announceAgent(created.agent)
  const result = await host.runStep(created.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(result.config.reasoningEffort, 'low')
  assert.equal(selectCalls.length, 0, 'scheduled Auto must not be materialized at turn/end')
  assert.equal(created.selectionEvents.length, 0)
  assert.notEqual(host.rawCurrent(created.agent).reasoningEffort, 'auto')
  assert.equal(created.agent.session.projection('modelSelection').pending, null)
})

test('NEXT FR-040: a native Auto subagent stays Auto without any plugin select call', async (t) => {
  const host = await autoModern(t)
  const parent = await announced(host, 'next-native-auto-parent')
  await host.runStep(parent.agent, { claimed: [userMessage(TRIVIAL)] })
  const child = host.createAgent('next-native-auto-child', {
    effort: 'auto',
    pending: nativeAuto(),
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const selectCalls = countSelects(child.agent)
  await host.announceAgent(child.agent)
  const result = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'high')
  assert.equal(child.agent.model.current().reasoningEffort, 'auto')
  assert.equal(host.rawCurrent(child.agent).reasoningEffort, 'auto')
  assert.equal(selectCalls.length, 0)
  assert.equal(child.selectionEvents.length, 0)
})

test('NEXT FR-003: an unsupported explicit manual effort is still restored after safe omission', async (t) => {
  const host = await autoModern(t, {}, {
    modelInfo: { reasoning: { default: 'low', efforts: [{ id: 'low' }] } },
  })
  const created = await announced(host, 'next-manual-unsupported-restore', { effort: 'max' })
  const result = await host.runStep(created.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, undefined)
  assert.equal(created.agent.model.current().reasoningEffort, 'max')
  assert.deepEqual(created.selectionEvents.map((row) => row.reasoningEffort), ['max'],
    'only the explicit manual restoration may write native selection')
})

test('NEXT FR-043: manual parent history blocks an older scheduled delegation witness', async (t) => {
  const host = await autoModern(t)
  const parent = await announced(host, 'next-delegation-manual-parent')
  const automatic = await host.runStep(parent.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(automatic.config.reasoningEffort, 'high')

  parent.agent.model.select(nativeEffort('high'))
  const manual = await host.runStep(parent.agent, { turn: 2, claimed: [userMessage(TRIVIAL)] })
  assert.equal(manual.config.reasoningEffort, 'high')
  const child = await announced(host, 'next-delegation-manual-child', {
    effort: 'high',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })

  parent.agent.model.select(nativeAuto())
  await host.runStep(parent.agent, { turn: 3, claimed: [userMessage(TRIVIAL)] })
  const inherited = await host.runStep(child.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(inherited.config.reasoningEffort, 'high',
    'the child was created from the intervening manual parent selection, not the older Auto high witness')
})

test('NEXT FR-043/074: pinned-default parent history blocks an older scheduled delegation witness', async (t) => {
  const host = await autoModern(t, { defaultLevel: 'high' })
  const id = 'next-delegation-default-parent'
  const parent = await announced(host, id)
  const automatic = await host.runStep(parent.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(automatic.config.reasoningEffort, 'high')

  const pinned = await announced(host, id, { effort: undefined, pending: null })
  const fixed = await host.runStep(pinned.agent, { turn: 2, claimed: [userMessage(TRIVIAL)] })
  assert.equal(fixed.config.reasoningEffort, 'high')
  const child = await announced(host, 'next-delegation-default-child', {
    effort: 'high',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: id },
  })

  pinned.agent.model.select(nativeAuto())
  await host.runStep(pinned.agent, { turn: 3, claimed: [userMessage(TRIVIAL)] })
  const inherited = await host.runStep(child.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(inherited.config.reasoningEffort, 'high',
    'a pinned default is a hard boundary before the older Auto high witness')
})

test('NEXT FR-042: a continuous Auto parent era retains the nonblocking delegation positive control', async (t) => {
  const host = await autoModern(t)
  const parent = await announced(host, 'next-delegation-nonblocking-parent')
  const first = await host.runStep(parent.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(first.config.reasoningEffort, 'high')
  const child = await announced(host, 'next-delegation-nonblocking-child', {
    effort: 'high',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const next = await host.runStep(parent.agent, {
    turn: 2,
    claimed: [],
    toolResult: toolResult('[exit code: 1] parent tool failed', true),
  })
  assert.equal(next.config.reasoningEffort, 'max', 'the newest Auto witness no longer matches the child seed')
  const scheduled = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(scheduled.config.reasoningEffort, 'high')
  assert.ok(host.logs.some((line) => line.includes(child.agent.id) && line.includes('subagent inherited')),
    'a newer Auto step must not hide the matching witness within the same continuous Auto era')
})

async function customModelResolution(t, resolved) {
  const section = { providers: { gw: { models: [{ id: 'm' }] } } }
  const writes = []
  let resolveCalls = 0
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', base: section, user: {}, value: section, revision: 1 }],
    update: async (ns, patch, expectedRevision) => { writes.push({ ns, patch, expectedRevision }) },
  }
  const host = modern(t, {}, {
    autoApply: false,
    modelInfo: async () => { resolveCalls += 1; return resolved },
    services: new Map([['settings', settings]]),
  })
  const warnings = []
  const warn = host.ctx.logger.warn
  host.ctx.logger.warn = (message) => {
    warnings.push(String(message))
    warn(message)
  }
  host.apply(entry.Config({}))
  for (let index = 0; index < 20 && resolveCalls === 0; index += 1) await settle()
  await settle()
  assert.equal(resolveCalls, 1, 'the custom-model candidate must actually be resolved')
  return { writes, warnings }
}

test('NEXT FR-053: unresolved custom-model metadata never fabricates reasoning levels', async (t) => {
  for (const [name, resolved] of [['null', null], ['undefined', undefined]]) {
    await t.test(name, async (subtest) => {
      const { writes, warnings } = await customModelResolution(subtest, resolved)
      assert.equal(writes.length, 0, 'missing model information is not confirmation of missing reasoning')
      assert.ok(warnings.some((line) => line.includes('gw/m')),
        'the skipped candidate must leave an actionable diagnostic')
    })
  }
})

test('NEXT FR-050: resolved reasoning:null retains the established custom-model fill', async (t) => {
  const { writes } = await customModelResolution(t, { reasoning: null })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].patch.providers.gw.models[0].reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
})
