import '../test-profile.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createModernHost, loadApplyForRuntime, userMessage } from '../helpers/host-0.2.2-harness.mjs'

const entry = await loadApplyForRuntime('0.2.2-alpha.2')

const ENGINEERING = '设计并实现一个支持高并发、幂等写入和故障恢复的分布式事务系统'
const TRIVIAL = '翻译这句话'

function modern(t, config = {}, hostOptions = {}) {
  const host = createModernHost({ apply: entry.apply, config: entry.Config(config), ...hostOptions })
  t.after(() => host.dispose())
  return host
}

async function autoModern(t, config = {}, hostOptions = {}) {
  const host = modern(t, config, hostOptions)
  await host.primeCapability()
  return host
}

test('F02-01 every claimed message contributes in either arrival order', async (t) => {
  const host = await autoModern(t)
  for (const [id, claimed] of [
    ['f02-batch-engineering-first', [userMessage(ENGINEERING), userMessage(TRIVIAL)]],
    ['f02-batch-trivial-first', [userMessage(TRIVIAL), userMessage(ENGINEERING)]],
  ]) {
    const { agent } = host.createAgent(id)
    const result = await host.runStep(agent, { claimed })
    assert.equal(result.config.reasoningEffort, 'high', id)
    assert.equal(agent.model.current().reasoningEffort, 'auto', id)
  }
})

test('F02-02 a concrete user selection between step/end and turn/end is never overwritten', async (t) => {
  const host = await autoModern(t)
  const { agent } = host.createAgent('f02-restore-race')
  const result = await host.runStep(agent, {
    claimed: [userMessage(ENGINEERING)],
    afterStepEnd() {
      agent.model.select({ provider: 'gw', model: 'thinker', reasoningEffort: 'max' })
    },
  })
  assert.equal(result.config.reasoningEffort, 'high')
  assert.equal(agent.model.current().reasoningEffort, 'max')
})

test('F02-03 resume reconstructs logical Auto from its own decision witness, not lastUsed', async (t) => {
  const id = 'f02-crash-resume'
  const crashed = await autoModern(t)
  const before = crashed.createAgent(id)
  const first = await crashed.runStep(before.agent, {
    claimed: [userMessage(TRIVIAL)],
    continues: true,
  })
  assert.equal(first.config.reasoningEffort, 'low')
  assert.equal(before.agent.model.current().reasoningEffort, 'low')
  crashed.dispose()

  const resumedHost = await autoModern(t)
  const resumed = resumedHost.createAgent(id, {
    lastUsed: { provider: 'gw', model: 'thinker', reasoningEffort: 'low' },
  })
  const second = await resumedHost.runStep(resumed.agent, {
    turn: 2, step: 1, claimed: [userMessage(ENGINEERING)],
  })
  assert.equal(second.config.reasoningEffort, 'high')
  assert.equal(resumed.agent.model.current().reasoningEffort, 'auto')
})

test('F02-04 disabled official Default remains omitted with no selection writes', async (t) => {
  const host = modern(t, { enabled: false })
  const { agent, selectionEvents } = host.createAgent('f02-default-disabled', { effort: undefined })
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, undefined)
  assert.equal(selectionEvents.length, 0)
})

test('F02-05 unresolved capability fails safe without awaiting and recovers after a transient failure', async (t) => {
  let rejectCapability
  const capability = new Promise((_resolve, reject) => { rejectCapability = reject })
  const llm = { adapters: new Map(), resolveModelInfo() { return capability } }
  const host = modern(t, {}, { llm })
  const { agent, events } = host.createAgent('f02-capability-wait')
  let settled = false
  const pending = host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
    .then((result) => { settled = true; return result })
  await new Promise((resolve) => setImmediate(resolve))
  const settledWithoutResolvingCapability = settled
  rejectCapability(new Error('temporary capability outage'))
  const result = await pending
  assert.equal(settledWithoutResolvingCapability, true, 'synchronous claimed must not await capability resolution')
  assert.equal(result.config.reasoningEffort, undefined, 'the deterministic safe outcome is omission, not an arbitrary accepted error')
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(host.requests.some((item) => ['auto', 'off'].includes(item.config.reasoningEffort)), false)
  assert.equal(events.filter((event) => event.type === 'request/header').length, 1)

  await new Promise((resolve) => setImmediate(resolve))
  llm.resolveModelInfo = async () => ({
    reasoning: { default: 'low', efforts: ['low', 'medium', 'high', 'max'].map((id) => ({ id })) },
  })
  // A failed resolution leaves no synchronous capability cache. Re-prime via a
  // separate manual concrete step before expecting the next claimed Auto step
  // to select high synchronously.
  await host.primeCapability()
  const recovered = await host.runStep(agent, { turn: 2, claimed: [userMessage(ENGINEERING)] })
  assert.equal(recovered.config.reasoningEffort, 'high', 'a transient failure must not poison the next resolution')
  assert.equal(agent.model.current().reasoningEffort, 'auto')
})

test('F02-06 fixed subagentEffort bypasses scheduling and preserves parent Auto', async (t) => {
  const host = await autoModern(t, { subagentEffort: 'max' })
  const parent = host.createAgent('f02-fixed-parent')
  await host.runStep(parent.agent, { claimed: [userMessage(ENGINEERING)] })
  const child = host.createAgent('f02-fixed-child', {
    effort: 'high',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await host.runStep(child.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(result.config.reasoningEffort, 'max')
  assert.equal(parent.agent.model.current().reasoningEffort, 'auto')
  assert.equal(child.agent.model.current().reasoningEffort, 'max')
  assert.equal(child.selectionEvents.some((event) => event.reasoningEffort === 'auto'), false)
  assert.equal(host.logs.filter((line) => line.includes('rank ') && line.includes(child.session.id)).length, 0)
})

test('F02-07 dispose during the restoration window prevents later Auto writes', async (t) => {
  const host = await autoModern(t)
  const { agent, selectionEvents } = host.createAgent('f02-dispose-restore')
  await host.runStep(agent, {
    claimed: [userMessage(ENGINEERING)],
    afterStepEnd() { host.dispose() },
  })
  assert.equal(selectionEvents.at(-1)?.reasoningEffort, 'high')
  assert.equal(host.logs.filter((line) => line.includes('async emit listener failed')).length, 0)
})

test('F02-08 an explicit fixed subagent off is honored without entering Auto scheduling', async (t) => {
  const host = await autoModern(t, { subagentEffort: 'off' })
  const parent = host.createAgent('f02-off-parent')
  await host.runStep(parent.agent, { claimed: [userMessage(ENGINEERING)] })
  const child = host.createAgent('f02-off-child', {
    effort: 'high',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'off')
  assert.equal(child.agent.model.current().reasoningEffort, 'off')
  assert.equal(child.selectionEvents.some((event) => event.reasoningEffort === 'auto'), false)
  assert.equal(host.logs.filter((line) => line.includes('rank ') && line.includes(child.session.id)).length, 0)
})
