/**
 * 0.2.15-rc.5 regressions — behavior contracts found by the rc.4 code review.
 *
 * Every test here failed against rc.4 before its fix:
 *   - parallel tool results share one assistant-call bucket;
 *   - Auto, the plugin's own sentinel, can never become a final effort;
 *   - manual-off poison provenance survives the 20-decision recent ring until
 *     the offending shape disappears;
 *   - a transient capability-resolution failure is retried;
 *   - adapter churn releases wrappers installed for removed adapters.
 */
import './test-profile.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as entry from '../lib/index.js'
import { createSignals } from '../lib/signals.js'
import { decideEffort, normalizePolicyConfig } from '../lib/policy.js'
import { createCapabilityResolver, UNRESOLVABLE_CAPABILITY } from '../lib/capability.js'
import { createStore } from '../lib/store.js'

const silentLogger = { info() {}, warn() {} }

const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistantCalls = (...names) => ({
  role: 'assistant',
  content: [
    { type: 'reasoning', text: 'thinking' },
    ...names.map((name, index) => ({ type: 'tool-call', name, arguments: '{"p":' + index + '}' })),
  ],
})
const v4Result = (text, isError, callId) => ({
  role: 'tool',
  toolCallId: callId,
  isError,
  source: { kind: 'tool', callId },
  content: [{ type: 'text', text }],
})

function makeSignals() {
  return createSignals({
    config: () => normalizePolicyConfig({}),
    logger: silentLogger,
  })
}

function makeAgent(messages) {
  return {
    sessionId: 'rc5-signals',
    session: { id: 'rc5-signals', header: {}, deriveMessages: () => messages },
  }
}

test('parallel tool results stay in ONE assistant-call bucket', () => {
  const signals = makeSignals()
  const messages = []
  const agent = makeAgent(messages)
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })

  // One assistant step issued two parallel calls; their results arrive as two
  // separate role:"tool" messages. The first is an error, the second is clean.
  messages.push(
    assistantCalls('read', 'grep'),
    v4Result('[exit code: 1] boom', true, 'c1'),
    v4Result('ok', false, 'c2'),
  )
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolCalls, 2, 'both calls belong to the one step')
  assert.equal(sig.taskErrors, 1)
  assert.equal(sig.weightedErrors, 1, 'the error sits in the newest bucket, not one bucket back')
  const decision = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(decision.targetRank, 3, 'the first error lifts standard by one rank')
})

test('a subagent-return bucket records its event once across parallel results', () => {
  const signals = makeSignals()
  const messages = []
  const agent = makeAgent(messages)
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  messages.push(
    assistantCalls('subagent', 'read'),
    v4Result('child done', false, 'c1'),
    v4Result('file body', false, 'c2'),
  )
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.subagentReturn, 1, 'one orchestration return, not two')
})

test('createCapabilityResolver retries after a transient resolution failure', async () => {
  let calls = 0
  const llm = {
    async resolveModelInfo() {
      calls += 1
      if (calls === 1) throw new Error('route not ready')
      return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }
    },
  }
  const capability = createCapabilityResolver({ llm: () => llm })
  assert.deepEqual(await capability.resolve('gw', 'thinker'), UNRESOLVABLE_CAPABILITY)
  const recovered = await capability.resolve('gw', 'thinker')
  assert.equal(recovered.supportsReasoning, true)
  assert.deepEqual(recovered.efforts, ['low', 'high'])
  assert.equal(calls, 2, 'the failed resolution was not cached for the process lifetime')
})

test('store keeps manual-off provenance beyond the 20-decision recent ring', () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-rc5-store-'))
  const file = join(dir, 'state.json')
  const store = createStore(file, silentLogger)
  store.record('s-poison', { at: 1, turn: 1, step: 1, mode: 'manual', effort: 'off' })
  for (let i = 0; i < 25; i += 1) {
    store.record('s-poison', { at: i + 2, turn: 1, step: i + 2, mode: 'poisoned', effort: 'off' })
  }
  assert.equal(store.recent('s-poison').some((d) => d.mode === 'manual' && d.effort === 'off'), false)
  assert.equal(store.hadManualOff('s-poison'), true, 'provenance is not tied to the recent ring')
  store.clearManualOff('s-poison')
  assert.equal(store.hadManualOff('s-poison'), false)
  store.dispose()

  // Old state files predate the flag: migrate it from their retained recent rows.
  const oldFile = join(dir, 'old-state.json')
  writeFileSync(oldFile, JSON.stringify({
    version: 1,
    sessions: {
      's-old': {
        last: { mode: 'poisoned', effort: 'off' },
        recent: [{ mode: 'manual', effort: 'off' }, { mode: 'poisoned', effort: 'off' }],
      },
    },
  }))
  const migrated = createStore(oldFile, silentLogger)
  assert.equal(migrated.hadManualOff('s-old'), true)
  migrated.record('s-old', { at: 99, turn: 1, step: 99, mode: 'auto', effort: 'high' })
  migrated.flush()
  assert.match(readFileSync(oldFile, 'utf8'), /"manualOff":true|"manualOff": true/)
})

/** Minimal ctx that can drive agent/request and adapter churn events. */
function hostHarness(options = {}) {
  const listeners = new Map()
  const logs = []
  const disposers = []
  const llm = options.llm ?? {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }, { id: 'auto' }] } }
    },
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn: (m) => logs.push(m) }),
    get(name) {
      if (name === 'llm') return llm
      throw new Error('no service ' + name)
    },
    on(event, handler) {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
    inject() { return () => {} },
    effect(run) {
      const dispose = run()
      disposers.push(dispose)
      return () => {}
    },
  }
  entry.apply(ctx, options.config ?? entry.Config({}))
  return {
    llm,
    logs,
    onRequest: listeners.get('agent/request'),
    onClaimed: listeners.get('agent/inbox/claimed'),
    churn: listeners.get('llm/adapters-updated'),
    dispose() {
      for (let i = disposers.length - 1; i >= 0; i -= 1) {
        if (typeof disposers[i] === 'function') disposers[i]()
      }
    },
  }
}

const request = (onRequest, agent, seed, turn = 1, step = 1) =>
  onRequest({ agent, turn, step }, async () => ({ ...seed }))

const plainAgent = (id, header = {}) => ({
  sessionId: id,
  session: { id, header, deriveMessages: () => [] },
})

test('fixed defaultLevel/subagentEffort never map onto the auto sentinel', async () => {
  const defaultHarness = hostHarness({ config: entry.Config({ defaultLevel: 'medium' }) })
  const defaultOut = await request(
    defaultHarness.onRequest,
    plainAgent('s-fixed-default'),
    { provider: 'gw', model: 'thinker' },
  )
  assert.equal(defaultOut.reasoningEffort, 'high', 'medium falls to the nearer concrete high, never auto')
  defaultHarness.dispose()

  const subHarness = hostHarness({ config: entry.Config({ subagentEffort: 'medium' }) })
  const subOut = await request(
    subHarness.onRequest,
    plainAgent('s-fixed-sub', { delegationDepth: 1 }),
    { provider: 'gw', model: 'thinker' },
  )
  assert.equal(subOut.reasoningEffort, 'high', 'subagentEffort obeys the same concrete-only rule')
  subHarness.dispose()
})

test('the interceptor catch strips auto but still fails open for a concrete seed', async () => {
  const hostile = Object.defineProperty({}, 'enabled', {
    get() { throw new Error('boom') },
  })
  const harness = hostHarness({ config: hostile })
  const autoSeed = { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }
  const autoOut = await request(harness.onRequest, plainAgent('s-catch-auto'), autoSeed)
  assert.notEqual(autoOut, autoSeed, 'the passed-through request is a copy')
  assert.equal(autoOut.reasoningEffort, undefined, 'our sentinel never reaches the host')
  assert.equal(autoSeed.reasoningEffort, 'auto', 'the incoming seed is not mutated')
  assert.ok(harness.logs.some((m) => m.includes('interceptor failed')))

  const concrete = { provider: 'gw', model: 'thinker', reasoningEffort: 'high' }
  const concreteOut = await harness.onRequest(
    { agent: plainAgent('s-catch-concrete'), turn: 1, step: 1 },
    async () => concrete,
  )
  assert.equal(concreteOut, concrete, 'concrete requests keep the fail-open reference contract')
  harness.dispose()
})

test('adapter churn releases wrappers installed for removed adapters', () => {
  const original = async () => ({ reasoning: { efforts: [{ id: 'low' }] } })
  const oldAdapter = { resolveModel: original }
  const llm = {
    adapters: new Map([['old', { adapter: oldAdapter }]]),
    async resolveModelInfo() { return {} },
  }
  const harness = hostHarness({ llm })
  assert.notEqual(oldAdapter.resolveModel, original, 'the live adapter is masked initially')
  llm.adapters.delete('old')
  harness.churn()
  assert.equal(oldAdapter.resolveModel, original, 'a removed adapter is released from the mask')

  const nextOriginal = async () => ({ reasoning: { efforts: [{ id: 'high' }] } })
  const nextAdapter = { resolveModel: nextOriginal }
  llm.adapters.set('next', { adapter: nextAdapter })
  harness.churn()
  assert.notEqual(nextAdapter.resolveModel, nextOriginal, 'the current adapter is re-wrapped')
  harness.dispose()
})

test('poison provenance survives >20 decisions and clears when the shape disappears', async () => {
  const harness = hostHarness()
  const agent = plainAgent('s-poison-many')
  const suspect = { role: 'assistant', content: [{ type: 'tool-call', name: 'calculator', arguments: '{}' }] }
  agent.session.deriveMessages = () => [
    { role: 'user', content: '帮我重构这个模块的缓存层' },
    suspect,
  ]
  harness.onClaimed({ agent, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })

  const manual = await request(harness.onRequest, agent, {
    provider: 'gw', model: 'thinker', reasoningEffort: 'off',
  })
  assert.equal(manual.reasoningEffort, 'off')

  for (let step = 2; step <= 26; step += 1) {
    const out = await request(harness.onRequest, agent, {
      provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
    }, 1, step)
    assert.equal(out.reasoningEffort, 'off', 'the proven pin survives step ' + step)
  }

  // Compaction removes the offending shape: pin and provenance both lift.
  agent.session.deriveMessages = () => [{ role: 'user', content: '帮我重构这个模块的缓存层' }]
  const cleaned = await request(harness.onRequest, agent, {
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }, 1, 27)
  assert.equal(cleaned.reasoningEffort, 'high')

  // A later unrelated K3-style shape must not be matched to the old manual off.
  agent.session.deriveMessages = () => [
    { role: 'user', content: '帮我重构这个模块的缓存层' },
    { role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] },
  ]
  const unrelated = await request(harness.onRequest, agent, {
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }, 1, 28)
  assert.equal(unrelated.reasoningEffort, 'high', 'old provenance was cleared with the old shape')

  // A fresh manual-off pick re-arms the proof.
  await request(harness.onRequest, agent, {
    provider: 'gw', model: 'thinker', reasoningEffort: 'off',
  }, 1, 29)
  const repinned = await request(harness.onRequest, agent, {
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }, 1, 30)
  assert.equal(repinned.reasoningEffort, 'off')
  harness.dispose()
})