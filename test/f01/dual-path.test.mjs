import '../test-profile.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assistantToolCall,
  createModernHost,
  loadApplyForRuntime,
  setTestRuntimeVersion,
  toolResult,
  userMessage,
} from '../helpers/host-0.2.2-harness.mjs'

const entry = await loadApplyForRuntime('0.2.2-alpha.2')
const legacyEntry = await loadApplyForRuntime('0.2.1-rc.5')
setTestRuntimeVersion('0.2.2-alpha.2')

const ENGINEERING = '设计并实现一个支持高并发、幂等写入和故障恢复的分布式事务系统'
const TRIVIAL = '翻译这句话'
const effort = (result) => result.config.reasoningEffort

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

test('F01-01 manifest and lockfile stop advertising the untested 0.2.x boundary', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const expected = '>=0.2.0-rc.1 <0.2.3-0'
  assert.equal(manifest.engines.dsh, expected)
  const peers = Object.keys(manifest.peerDependencies)
  assert.equal(peers.length, 7, 'six existing host packages plus the public app-boot runtime API')
  assert.ok(peers.includes('@deepseek-ai/dsh-app-boot'))
  for (const name of peers) assert.equal(manifest.peerDependencies[name], expected, name)
  const lock = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8')
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const name of peers) {
    assert.match(lock, new RegExp("'" + escape(name) + "':\\s*\\n\\s+specifier: '" + escape(expected) + "'"), name)
  }
})

test('F01-02 first Auto step is concrete before selection capture and remains logical Auto', async (t) => {
  const host = await autoModern(t)
  const { agent, events, selectionEvents } = await announced(host,'f01-first')
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(result), 'high')
  assert.equal(result.selection.reasoningEffort, 'high')
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(agent.session.projection('modelSelection').pending, null, 'capture does not fabricate a native Auto pending pick')
  assert.equal(selectionEvents.length, 0, 'FR-076: scheduled Auto never re-enters native selection memory')
  assert.equal(host.requests.length, 1, 'the prepared request is still sent')
  assert.equal(events.find((event) => event.type === 'request/header')?.data.header.config.reasoningEffort, 'high')
  assert.equal(host.logs.filter((line) => line.includes('rank 4 (high)') && line.includes(agent.session.id)).length, 1)
})

test('F01-03 tool continuation recalculates without another inbox claim', async (t) => {
  const host = await autoModern(t)
  const { agent, selectionEvents } = await announced(host,'f01-tool')
  const first = await host.runStep(agent, {
    claimed: [userMessage(TRIVIAL)],
    assistant: assistantToolCall(),
    toolResults: [toolResult('[exit code: 1] read failed', true)],
    continues: true,
  })
  assert.equal(effort(first), 'low')
  const second = await host.runStep(agent, { step: 2 })
  assert.equal(effort(second), 'medium')
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(agent.session.projection('modelSelection').pending, null)
  assert.equal(selectionEvents.length, 0)
  assert.equal(host.selectionCaptures.length, 2)
})

test('F01-04 same-step retry reuses the fixed selection without rescheduling', async (t) => {
  const singleHost = await autoModern(t)
  const single = await announced(singleHost,'f01-retry-single')
  await singleHost.runStep(single.agent, { claimed: [userMessage(ENGINEERING)] })
  const retryHost = await autoModern(t)
  const retry = await announced(retryHost,'f01-retry-three')
  let streamAttempt = 0
  let preSteps = 0
  const failures = []
  retryHost.ctx.on('agent/pre-step', (_event, next) => { preSteps += 1; return next() })
  retryHost.llm.prepareCall = async (config) => ({
    config,
    retryPolicy: { remaining: 2 },
    async *stream() {
      streamAttempt += 1
      if (streamAttempt < 3) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: `stream ${streamAttempt}`, code: 'TEST_RETRY' } } }
      } else {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    },
  })
  retryHost.ctx.on('agent/request-error', (event) => {
    failures.push(event.failure.message)
    return { kind: 'retry' }
  })
  const result = await retryHost.runStep(retry.agent, {
    claimed: [userMessage(ENGINEERING)],
    maxAttempts: 3,
  })
  assert.deepEqual(failures, ['stream 1', 'stream 2'])
  assert.equal(preSteps, 1)
  assert.equal(result.attempts, 3)
  assert.deepEqual(retryHost.requests.map((item) => item.config.reasoningEffort), ['high', 'high', 'high'])
  assert.equal(retry.agent.model.current().reasoningEffort, 'auto')
  assert.equal(retry.agent.session.projection('modelSelection').pending, null)
  assert.equal(retry.selectionEvents.length, 0)
  const decisions = (logs) => logs.filter((line) => line.includes('rank ')).length
  assert.ok(decisions(singleHost.logs) > 0, 'positive control: the single attempt really scheduled')
  assert.equal(decisions(retryHost.logs), decisions(singleHost.logs))
  const requestHeaders = retry.session.events.filter((event) => event.type === 'request/header')
  assert.equal(requestHeaders.length, 1, 'retry repeats preparation and streaming, not a duplicate identical header')
})

test('F01-05 concrete manual selection is never rewritten or reverted', async (t) => {
  const host = modern(t)
  const { agent, selectionEvents } = await announced(host,'f01-manual', { effort: 'max' })
  const result = await host.runStep(agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(effort(result), 'max')
  assert.equal(agent.model.current().reasoningEffort, 'max')
  assert.equal(selectionEvents.length, 0)
})

test('F01-06 manual takeover needs no restoration and explicit Auto resumes', async (t) => {
  const host = await autoModern(t)
  const { agent } = await announced(host,'f01-takeover')
  await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  agent.model.select({ provider: 'gw', model: 'thinker', reasoningEffort: 'max' })
  const manual = await host.runStep(agent, {
    turn: 2, step: 1, claimed: [userMessage(TRIVIAL)],
  })
  assert.equal(effort(manual), 'max')
  assert.equal(agent.model.current().reasoningEffort, 'max')
  agent.model.select({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  const automatic = await host.runStep(agent, { turn: 3, step: 1, claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(automatic), 'high')
  assert.equal(agent.model.current().reasoningEffort, 'auto')
})

test('F01-07 disabled mode strips private Auto only from the concrete capture', async (t) => {
  const host = modern(t, { enabled: false })
  const { agent } = await announced(host,'f01-disabled')
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(result), undefined)
  assert.equal(agent.model.current().reasoningEffort, 'auto')
  assert.equal(agent.session.projection('modelSelection').pending, null)
  assert.equal(host.logs.filter((line) => line.includes('rank ')).length, 0)
})

test('F01-08 pinned default uses the same safe path but is not logical Auto', async (t) => {
  const host = await autoModern(t, { defaultLevel: 'high' })
  const { agent } = await announced(host,'f01-default', { effort: undefined })
  const result = await host.runStep(agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(effort(result), 'high')
  assert.equal(agent.model.current().reasoningEffort, undefined,
    'the pinned default is a capture, not a native selection write')
  assert.equal(agent.session.projection('modelSelection').pending, null)
  assert.equal(host.logs.filter((line) => line.includes('rank ')).length, 0)
})

test('F01-09 unsupported and off-only models never receive private Auto or explicit off', async (t) => {
  const unsupported = await autoModern(t, { defaultLevel: 'high' }, {
    llm: { adapters: new Map(), async resolveModelInfo() { return { reasoning: null } } },
  })
  const first = await announced(unsupported,'f01-unsupported')
  const fallback = await unsupported.runStep(first.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(fallback), undefined, 'an unsupported model must not receive the pinned high effort')

  const offOnly = await autoModern(t, {}, {
    llm: { adapters: new Map(), async resolveModelInfo() { return { reasoning: { efforts: [{ id: 'off' }] } } } },
  })
  const second = await announced(offOnly,'f01-off-only')
  const outcome = await offOnly.runStep(second.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(outcome), undefined, 'off-only fails closed to the provider default, never a guess or explicit off')
  assert.equal(second.agent.model.current().reasoningEffort, 'auto', 'logical Auto survives the safe omission')
  assert.equal(second.agent.session.projection('modelSelection').pending, null)
  assert.equal(offOnly.requests.some((item) => ['auto', 'off'].includes(item.config.reasoningEffort)), false)
})

test('F01-10 modern path preserves capability allow-list and nearest-up mapping', async (t) => {
  const host = await autoModern(t, { allowedEfforts: ['high'] }, {
    llm: {
      adapters: new Map(),
      async resolveModelInfo() {
        return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
      },
    },
  })
  const { agent } = await announced(host,'f01-allow')
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(result), 'high')
})

test('F01-10b explicit allowedEfforts filters final ids, not interpolated ranks', async (t) => {
  const host = await autoModern(t, { allowedEfforts: ['medium', 'max'] }, {
    llm: {
      adapters: new Map(),
      async resolveModelInfo() {
        return { reasoning: { efforts: [
          { id: 'low' },
          { id: 'vendor-3' },
          { id: 'vendor-4' },
          { id: 'vendor-5' },
          { id: 'max' },
        ] } }
      },
    },
  })
  const { agent } = await announced(host, 'f01-allow-final-ids')
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(result), 'max',
    'an unknown vendor id must not borrow an allowed canonical rank to escape the final-id allow-list')
})

test('F01-11 subagent with Auto parent schedules from its own brief without native selection writes', async (t) => {
  const host = await autoModern(t)
  const parent = await announced(host,'f01-parent')
  await host.runStep(parent.agent, { claimed: [userMessage(TRIVIAL)] })
  const child = await announced(host,'f01-child', {
    effort: 'low',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(result), 'high')
  assert.equal(parent.agent.model.current().reasoningEffort, 'auto')
  assert.equal(child.agent.model.current().reasoningEffort, 'low',
    'a concrete inherited child keeps the native inherited value')
  assert.equal(child.agent.session.projection('modelSelection').pending, null)
  assert.equal(child.selectionEvents.length, 0, 'FR-076: scheduled delegation output never enters native selection memory')
})

test('F01-12 subagent inherits a concrete parent selection verbatim', async (t) => {
  const host = modern(t)
  const parent = await announced(host,'f01-manual-parent', { effort: 'max' })
  await host.runStep(parent.agent, { claimed: [userMessage(TRIVIAL)] })
  const child = await announced(host,'f01-manual-child', {
    effort: 'max',
    header: { origin: 'subagent', delegationDepth: 1, parentSession: parent.session.id },
  })
  const result = await host.runStep(child.agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(effort(result), 'max')
  assert.equal(parent.agent.model.current().reasoningEffort, 'max')
  assert.equal(child.agent.model.current().reasoningEffort, 'max')
  assert.equal(child.selectionEvents.some((event) => event.reasoningEffort === 'auto'), false)
})

test('F01-13 dispose during legacy downstream await cannot record or append stale Auto', async () => {
  const listeners = new Map()
  const effects = []
  let appended = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() { return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] } } },
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
      return () => { const index = list.indexOf(fn); if (index >= 0) list.splice(index, 1) }
    },
    inject() {}, effect(fn) { const off = fn(); if (off) effects.push(off); return () => {} },
  }
  setTestRuntimeVersion('0.2.1-rc.5')
  legacyEntry.apply(ctx, legacyEntry.Config({}))
  const agent = {
    sessionId: 'f01-dispose-next',
    session: {
      header: {}, deriveMessages: () => [{ role: 'user', content: ENGINEERING }],
      append() { appended += 1 }, requestHeader: () => ({}),
    },
    model: { select() { appended += 1 } },
  }
  ctx.on('agent/request', async (_event, next) => { await next(); await gate; return { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' } })
  let next = async () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  for (const handler of [...listeners.get('agent/request')].reverse()) {
    const downstream = next
    next = (current) => handler(current, downstream)
  }
  const pending = next({ agent, turn: 1, step: 1 })
  await new Promise((resolve) => setImmediate(resolve))
  for (const off of effects.reverse()) off()
  release()
  const result = await pending
  assert.equal(result.reasoningEffort, undefined)
  assert.equal(appended, 0)
})

test('F01-14 concrete last-used state on resume is manual, not an Auto store witness', async (t) => {
  const id = 'f01-resume-auto'
  const firstHost = await autoModern(t)
  const first = await announced(firstHost,id)
  const initial = await firstHost.runStep(first.agent, { claimed: [userMessage(TRIVIAL)] })
  assert.equal(effort(initial), 'low')
  firstHost.dispose()
  const resumedHost = await autoModern(t)
  const resumed = await announced(resumedHost,id, {
    lastUsed: { provider: 'gw', model: 'thinker', reasoningEffort: 'low' },
  })
  const result = await resumedHost.runStep(resumed.agent, {
    turn: 2, step: 1, claimed: [userMessage(ENGINEERING)],
  })
  assert.equal(effort(result), 'low')
  assert.equal(resumed.agent.model.current().reasoningEffort, 'low')
  assert.equal(resumed.agent.session.projection('modelSelection').pending, null)
  assert.equal(resumed.selectionEvents.length, 0)
})

test('F01-15 same-session concrete manual resume is not rescued by brief evidence', async (t) => {
  const id = 'f01-resume-manual'
  const firstHost = modern(t)
  const first = await announced(firstHost,id, { effort: 'low' })
  await firstHost.runStep(first.agent, { claimed: [userMessage(TRIVIAL)] })
  firstHost.dispose()
  const resumedHost = modern(t)
  const resumed = await announced(resumedHost,id, {
    lastUsed: { provider: 'gw', model: 'thinker', reasoningEffort: 'low' },
  })
  const result = await resumedHost.runStep(resumed.agent, {
    turn: 2, step: 1, claimed: [userMessage(ENGINEERING)],
  })
  assert.equal(effort(result), 'low')
  assert.equal(resumed.agent.model.current().reasoningEffort, 'low')
})
