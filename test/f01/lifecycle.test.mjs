import '../test-profile.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { TEST_STORE_FILE } from '../test-profile.mjs'
import {
  createModernHost,
  loadApplyForRuntime,
  setTestRuntimeVersion,
  userMessage,
} from '../helpers/host-0.2.2-harness.mjs'

const entry = await loadApplyForRuntime('0.2.2-alpha.2')
const legacyEntry = await loadApplyForRuntime('0.2.1-rc.2')
const rejectedEntries = new Map(await Promise.all(
  ['9.9.9', '0.2.2-alpha.1'].map(async (runtime) => [runtime, await loadApplyForRuntime(runtime)]),
))
setTestRuntimeVersion('0.2.2-alpha.2')
const ENGINEERING = '设计并实现一个支持高并发、幂等写入和故障恢复的分布式事务系统'

function storedDecisions(sessionId) {
  try {
    const state = JSON.parse(readFileSync(TEST_STORE_FILE, 'utf8'))
    return state.sessions?.[sessionId]?.recent ?? []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function lastDecisionThrough(route, sessionId) {
  const res = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(text) { this.body = text },
  }
  await route.handler({ url: `/effort-router/state?view=badge&sessionId=${encodeURIComponent(sessionId)}` }, res)
  assert.equal(res.status, 200)
  return JSON.parse(res.body).last ?? null
}

function modern(t, config = {}, hostOptions = {}) {
  setTestRuntimeVersion('0.2.2-alpha.2')
  const host = createModernHost({ apply: entry.apply, config: entry.Config(config), ...hostOptions })
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

test('F01-17 a modern runtime without model.select still resolves Auto through current', async (t) => {
  const host = await autoModern(t)
  const { agent } = await announced(host,'f01-no-select', { modelSelect: false })
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'high', 'D needs current, not the retired selection writer')
  assert.equal(host.requests.length, 1)
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(host.eventErrors.length, 0)
})

test('F01-18 unsupported or unverified host runtimes fail loudly instead of guessing a path', async () => {
  for (const runtime of ['9.9.9', '0.2.2-alpha.1']) {
    const candidate = rejectedEntries.get(runtime)
    setTestRuntimeVersion(runtime)
    assert.throws(
      () => createModernHost({ apply: candidate.apply, config: candidate.Config({}) }),
      /runtime|version|unsupported|unverified|0\.2/i,
      `${runtime}: a wide manifest range must not imply runtime certification`,
    )
  }
})

test('F01-19 abort during streaming preserves logical Auto without a restoration write', async (t) => {
  const host = await autoModern(t)
  const controller = new AbortController()
  host.llm.prepareCall = async (config) => ({
    config,
    async stream() {
      controller.abort()
      throw Object.assign(new Error('aborted by test'), { name: 'AbortError' })
    },
  })
  const { agent, selectionEvents } = await announced(host,'f01-abort')
  await assert.rejects(
    host.runStep(agent, { claimed: [userMessage(ENGINEERING)], signal: controller.signal }),
    /aborted by test/,
  )
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(agent.session.projection('modelSelection').pending, null)
  assert.equal(selectionEvents.every((event) => event.reasoningEffort === 'auto'), true)
  assert.equal(host.eventErrors.length, 0)
})

test('F01-20 dispose during modern prepareCall prevents late writes and restores raw current', async (t) => {
  const routes = []
  const services = new Map([['webServer', {
    register(route) { routes.push(route); return () => {} },
  }]])
  const host = await autoModern(t, {}, { services })
  const stateRoute = routes.find((route) => route.path === '/effort-router/state')
  assert.ok(stateRoute, 'the public read route observes the in-memory decision store')
  let enterPreparation
  let releasePreparation
  const entered = new Promise((resolve) => { enterPreparation = resolve })
  const gate = new Promise((resolve) => { releasePreparation = resolve })
  host.llm.prepareCall = async (config) => {
    enterPreparation()
    await gate
    return { config }
  }
  const { agent, selectionEvents } = await announced(host,'f01-modern-dispose')
  const pending = host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  await entered
  host.dispose()
  const writesAtDispose = selectionEvents.length
  const decisionAtDispose = await lastDecisionThrough(stateRoute, agent.sessionId)
  releasePreparation()
  const result = await pending
  assert.equal(result.config.reasoningEffort, 'high')
  assert.equal(selectionEvents.length, writesAtDispose, 'no listener may write after the plugin is disposed')
  assert.equal(selectionEvents.every((event) => event.reasoningEffort === 'auto'), true)
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(agent.session.projection('modelSelection').pending, null)
  // Read the public in-memory projection: a second dispose is idempotent and
  // cannot flush an illegal late debounce, so a disk-only assertion could pass vacuously.
  assert.deepEqual(await lastDecisionThrough(stateRoute, agent.sessionId), decisionAtDispose, 'no decision is recorded after disposal')
})

test('F01-21 a delayed session A completion cannot restore or schedule into session B', async (t) => {
  const host = await autoModern(t)
  const a = await announced(host,'f01-session-a')
  const b = await announced(host,'f01-session-b')
  let releaseA
  const gate = new Promise((resolve) => { releaseA = resolve })
  const pendingA = host.runStep(a.agent, {
    claimed: [userMessage(ENGINEERING)],
    async afterStepEnd() { await gate },
  })
  const resultB = await host.runStep(b.agent, { claimed: [userMessage(ENGINEERING)] })
  releaseA()
  const resultA = await pendingA
  assert.equal(resultA.config.reasoningEffort, 'high')
  assert.equal(resultB.config.reasoningEffort, 'high')
  assert.equal(a.agent.model.current().reasoningEffort, 'auto')
  assert.equal(b.agent.model.current().reasoningEffort, 'auto')
  assert.equal(a.selectionEvents.every((event) => event.reasoningEffort === 'auto'), true)
  assert.equal(b.selectionEvents.every((event) => event.reasoningEffort === 'auto'), true)
  assert.equal(a.agent.session.projection('modelSelection').pending, null)
  assert.equal(b.agent.session.projection('modelSelection').pending, null)
})

test('F01-22 an unsupported subagent model strips inherited effort instead of guessing', async (t) => {
  const host = await autoModern(t)
  const parent = await announced(host,'f01-unknown-parent')
  await host.runStep(parent.agent, { claimed: [userMessage('翻译这句话')] })
  const warmUnknown = await announced(host,'f01-unknown-capability-prime', {
    effort: 'high', options: { provider: 'unknown-provider', model: 'unknown-model' },
  })
  await host.runStep(warmUnknown.agent, { claimed: [userMessage('预热未知模型能力')] })
  const child = await announced(host,'f01-unknown-child', {
    effort: 'low',
    options: { provider: 'unknown-provider', model: 'unknown-model' },
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, undefined)
  assert.equal(child.agent.model.current().reasoningEffort, 'low')
  assert.equal(child.selectionEvents.some((event) => ['auto', 'off'].includes(event.reasoningEffort)), false)
})

test('F01-23 a subagent seed that differs from the parent decision remains a manual pick', async (t) => {
  const host = await autoModern(t)
  const parent = await announced(host,'f01-mismatch-parent')
  await host.runStep(parent.agent, { claimed: [userMessage('翻译这句话')] })
  const child = await announced(host,'f01-mismatch-child', {
    effort: 'medium',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'medium')
  assert.equal(child.agent.model.current().reasoningEffort, 'medium')
  assert.equal(child.selectionEvents.length, 0)
})

test('F01-24 a stale pre-branch completion cannot write into the replacement session generation', async (t) => {
  const host = await autoModern(t)
  let enterPreparation
  let releasePreparation
  const entered = new Promise((resolve) => { enterPreparation = resolve })
  const gate = new Promise((resolve) => { releasePreparation = resolve })
  host.llm.prepareCall = async (config) => {
    enterPreparation()
    await gate
    return { config }
  }
  const oldGeneration = await announced(host,'f01-branch-generation')
  const oldPending = host.runStep(oldGeneration.agent, { claimed: [userMessage(ENGINEERING)] })
  await entered

  // Same host and same public session id: only the replacement generation may
  // receive subsequent restoration writes. A separate-host assertion would be
  // vacuous because the old listeners could never reach the new host.
  const replacement = await announced(host,'f01-branch-generation', {
    pending: { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' },
  })
  host.llm.prepareCall = async (config) => ({ config })
  const result = await host.runStep(replacement.agent, {
    turn: 2, step: 1, claimed: [userMessage('翻译这句话')],
  })
  assert.equal(result.config.reasoningEffort, 'low')
  assert.equal(replacement.selectionEvents.every((event) => event.reasoningEffort === 'auto'), true)

  releasePreparation()
  await oldPending
  host.dispose() // flush any stale late record into the shared test store
  assert.equal(replacement.selectionEvents.every((event) => event.reasoningEffort === 'auto'), true)
  assert.equal(replacement.agent.model.current().reasoningEffort, 'auto')
  assert.equal(replacement.agent.session.projection('modelSelection').pending, null)
  const decisions = storedDecisions(replacement.agent.sessionId)
  assert.equal(decisions.at(-1)?.turn, 2, 'the newest durable decision belongs to the replacement generation')
  assert.equal(decisions.filter((decision) => decision.turn === 1).length <= 1, true, 'the old generation cannot add a second late decision')
})

test('F01-25 dispose while legacy capability is pending prevents every late write', async (t) => {
  const listeners = new Map()
  const effects = []
  const appended = []
  let enterCapability
  let releaseCapability
  const entered = new Promise((resolve) => { enterCapability = resolve })
  const gate = new Promise((resolve) => { releaseCapability = resolve })
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      enterCapability()
      await gate
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
    effect(fn) { const off = fn(); if (off) effects.push(off); return off ?? (() => {}) },
  }
  setTestRuntimeVersion('0.2.1-rc.2')
  legacyEntry.apply(ctx, legacyEntry.Config({}))
  const agent = {
    sessionId: 'f01-legacy-capability-dispose',
    session: {
      header: {},
      deriveMessages: () => [{ role: 'user', content: ENGINEERING }],
      append(type, data) { appended.push({ type, data }) },
      requestHeader: () => ({}),
    },
    model: { current: () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }) },
  }
  let next = async () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  for (const handler of [...listeners.get('agent/request')].reverse()) {
    const downstream = next
    next = (current) => handler(current, downstream)
  }
  const pending = next({ agent, turn: 1, step: 1 })
  await entered
  for (const off of [...effects].reverse()) off()
  releaseCapability()
  const result = await pending
  for (const off of [...effects].reverse()) off() // flush an illegal late record
  assert.equal(result.reasoningEffort, undefined, 'a disposed late resolution strips the synthetic selector')
  assert.equal(appended.length, 0, 'no durable logical-Auto witness is appended after disposal')
  assert.deepEqual(storedDecisions(agent.sessionId), [], 'no decision is recorded after disposal')
})
