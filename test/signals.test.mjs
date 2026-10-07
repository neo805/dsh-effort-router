/**
 * signals.js tests with a synthetic agent/session, plus the full schedule
 * composition (decideEffort -> hysteresis) the host interceptor runs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSignals } from '../lib/signals.js'
import { decideEffort, normalizePolicyConfig } from '../lib/policy.js'

const silentLogger = { info() {}, warn() {} }

function makeAgent(messages) {
  return {
    sessionId: 's1',
    session: {
      id: 's1',
      header: {},
      deriveMessages: () => messages,
    },
  }
}

function makeSignals(cfg = {}) {
  return createSignals({ config: () => normalizePolicyConfig(cfg), logger: silentLogger, projections: undefined })
}

const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistantCall = (name, args = '{}') => ({
  role: 'assistant',
  content: [{ type: 'reasoning', text: 'thinking' }, { type: 'tool-call', name, arguments: args }],
})
const toolResult = (text, isError = false) => ({
  role: 'user',
  content: [{ type: 'tool-result', content: [{ type: 'text', text }], isError }],
})

test('collect: claimed brief text is classified', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.ok(sig.text.includes('重构'))
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'engineering')
})

test('collect: falls back to the last user message when no claim seen', () => {
  const signals = makeSignals()
  const agent = makeAgent([userMsg('解释一下这段代码')])
  const sig = signals.collect(agent, { turn: 3, step: 1 })
  assert.ok(sig.text.includes('解释'))
})

test('tool evidence accumulates and escalates on errors', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  // step 1: no errors yet
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.escalations, 0)
  // the session gains two failed tool results
  agent.session.messages = [
    assistantCall('read', '{"p":"a"}'),
    toolResult('[exit code: 1] boom'),
    assistantCall('read', '{"p":"b"}'),
    toolResult('[exit code: 2] boom again'),
  ]
  agent.session.deriveMessages = () => agent.session.messages
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 2)
  assert.equal(sig.escalations, 1) // >= escalateOnErrors(2) -> 1
  // and the schedule reflects it: standard +1 -> engineering -> high
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'engineering')
})

test('repeated identical tool calls escalate', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('检查'), turn: 1 })
  const same = JSON.stringify({ p: 'same' })
  agent.session.deriveMessages = () => [
    assistantCall('read', same),
    toolResult('ok'),
    assistantCall('read', same),
    toolResult('ok'),
    assistantCall('read', same),
    toolResult('ok'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.taskRepeats, 2)
  assert.equal(sig.escalations, 0) // 2 repeats < escalateOnRepeats(3)
})

test('a new claim retires the evidence of the previous task', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('任务一'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('bash', '{"c":"x"}'),
    toolResult('[exit code: 9] fail'),
    assistantCall('bash', '{"c":"y"}'),
    toolResult('[exit code: 9] fail again'),
  ]
  signals.collect(agent, { turn: 1, step: 2 })
  signals.onClaimed({ agent, message: userMsg('任务二'), turn: 2 })
  const sig = signals.collect(agent, { turn: 2, step: 1 })
  assert.equal(sig.taskErrors, 0)
  assert.equal(sig.carry, 1) // previous task ended on unresolved failure
})

test('hysteresis holds a downgrade for downAfter quiet decisions', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  const cfg = normalizePolicyConfig({})
  // raise first (immediate)
  let s = signals.stabilizeEffort(agent, 'high', cfg.downAfter)
  assert.equal(s.tier, 'high')
  // quieter desired: held once, applied on the second
  s = signals.stabilizeEffort(agent, 'low', cfg.downAfter)
  assert.equal(s.tier, 'high')
  assert.equal(s.held, true)
  s = signals.stabilizeEffort(agent, 'low', cfg.downAfter)
  assert.equal(s.tier, 'low')
})

test('poisoned history is detected and cleared after a shrink', () => {
  const signals = makeSignals()
  const agent = makeAgent([
    userMsg('do something'),
    { role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] }, // no reasoning block
  ])
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.poisonedHistory, true)
  // compaction summarizes the offending turn away: the projection SHRINKS
  agent.session.deriveMessages = () => [userMsg('summary')]
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.poisonedHistory, false)
})

test('loud degradation: missing deriveMessages warns once and still classifies the brief', () => {
  const warnings = []
  const signals = createSignals({
    config: () => normalizePolicyConfig({}),
    logger: { info() {}, warn: (m) => warnings.push(m) },
    projections: undefined,
  })
  const agent = { sessionId: 's2', session: { id: 's2' } }
  signals.onClaimed({ agent, message: userMsg('重构缓存'), turn: 1 })
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.toolCalls, 0)
  assert.ok(sig.text.includes('重构')) // brief still drives classification
  signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(warnings.filter((w) => w.includes('deriveMessages')).length, 1) // warned exactly once
})

test('projection signals: pressure above threshold marks frugal', () => {
  const projections = {
    stateOf: (_session, key) => {
      if (key === 'contextPressure') return { contextWindow: 100, pressureTokens: 90 }
      if (key === 'todos') return [{ status: 'in_progress', content: '实现缓存层' }]
      return undefined
    },
  }
  const signals = createSignals({
    config: () => normalizePolicyConfig({ contextPressure: 0.75 }),
    logger: silentLogger,
    projections,
  })
  const agent = makeAgent([])
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.frugal, true)
  assert.ok(sig.frugalWhy.includes('context pressure'))
  assert.ok(sig.text.includes('实现缓存层')) // todo folded into the brief
})

test('delegationDepth from the session header marks subagents frugal', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  agent.session.header = { delegationDepth: 1 }
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.delegationDepth, 1)
  assert.equal(sig.frugal, true)
  assert.equal(sig.frugalWhy, 'subagent')
})
