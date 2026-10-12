/**
 * signals.js tests with a synthetic agent/session: sliding-window evidence,
 * volume cues, plus the full schedule composition (decideEffort -> hysteresis)
 * the host interceptor runs.
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
  assert.ok(sig.briefTokens > 0, 'brief token estimate is exposed')
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'engineering')
})

test('collect: falls back to the last user message when no claim seen', () => {
  const signals = makeSignals()
  const agent = makeAgent([userMsg('解释一下这段代码')])
  const sig = signals.collect(agent, { turn: 3, step: 1 })
  assert.ok(sig.text.includes('解释'))
})

test('tool evidence folds into the window and escalates on errors', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  // step 1: no errors yet
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.escalations, 0)
  // one failed tool result: the FIRST error already lifts (0.2.6, audit R4.1)
  agent.session.messages = [
    assistantCall('read', '{"p":"a"}'),
    toolResult('[exit code: 1] boom'),
  ]
  agent.session.deriveMessages = () => agent.session.messages
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolCalls, 1)
  assert.equal(sig.taskErrors, 1)
  assert.equal(sig.escalations, 1) // >= escalateOnErrors(1) -> 1
  assert.ok(sig.toolVolume > 0, 'tool-result volume is tracked')
  // a second failure reaches the +2 rung (errors >= onErrors*2)
  agent.session.messages = [
    ...agent.session.messages,
    assistantCall('read', '{"p":"b"}'),
    toolResult('[exit code: 2] boom again'),
  ]
  sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 2)
  assert.equal(sig.escalations, 2)
  // and the schedule reflects it: standard +2 -> hard -> max
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'hard')
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

test('the sliding window ages old evidence out', () => {
  // window of 2 step buckets: the first error retires once two newer buckets seal
  const signals = makeSignals({ scoring: { toolWindow: 2 } })
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    toolResult('[exit code: 1] boom'),     // bucket 1: 1 error — evicted below
    assistantCall('read', '{"p":"b"}'),
    toolResult('[exit code: 1] bam'),      // bucket 2: 1 error — kept
    assistantCall('read', '{"p":"c"}'),
    toolResult('ok'),                      // bucket 3: clean — kept
  ]
  const sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.toolCalls, 2, 'only the last 2 buckets count their calls')
  assert.equal(sig.taskErrors, 1, 'the oldest error aged out of the window')
  assert.equal(sig.escalations, 1, 'the surviving single error still lifts (0.2.6, audit R4.1)')
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

test('off-shape history is detected and cleared after a shrink (shape fact, not poison)', () => {
  const signals = makeSignals()
  const agent = makeAgent([
    userMsg('do something'),
    { role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] }, // no reasoning block
  ])
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.offShapeHistory, true)
  // compaction summarizes the offending turn away: the projection SHRINKS
  agent.session.deriveMessages = () => [userMsg('summary')]
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.offShapeHistory, false)
})

test('off shape alone does NOT poison the decision (the kimi-K3 false positive)', () => {
  // K3 with thinking ON emits no reasoning block before a tool call. decideEffort
  // only reads caller-PROVEN poison (signals.poisonedHistory), which the host
  // sets from shape + store provenance — a bare offShapeHistory never pins off.
  const signals = makeSignals()
  const agent = makeAgent([
    userMsg('do something'),
    { role: 'assistant', content: [{ type: 'tool-call', name: 'calculator', arguments: '{}' }] },
  ])
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.offShapeHistory, true)
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.poisoned, false)
  assert.notEqual(d.tier, 'off')
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

/** DSH v4 shape: first-class role:"tool" message (verified against the host's own construction). */
const v4ToolResult = (text, isError = false, callId = 'c1') => ({
  role: 'tool',
  toolCallId: callId,
  isError,
  source: { kind: 'tool', callId },
  content: [{ type: 'text', text }],
})

test('v4 tool channel: message-level isError folds into the window (audit R1)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    v4ToolResult('Error: boom', true, 'c1'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolCalls, 1)
  assert.equal(sig.taskErrors, 1, 'v4 message-level isError counts')
  assert.equal(sig.escalations, 1, 'the v4 error reaches escalateOnErrors(1)')
  assert.ok(sig.toolVolume > 0, 'v4 text blocks count toward result volume')
})

test('v4 tool channel: exit-code text counts without the flag; clean results do not', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('跑一下'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('pwsh', '{"command":"a"}'),
    v4ToolResult('done\n[exit code: 1]', false, 'c1'), // flag false but text reports failure
    assistantCall('pwsh', '{"command":"b"}'),
    v4ToolResult('all good', false, 'c2'), // no marker at all
  ]
  const sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 1, 'only the exit-code result counts')
})

test('mixed v4 + v0/v3 history folds each result exactly once', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    v4ToolResult('Error: boom', true, 'c1'), // v4
    assistantCall('read', '{"p":"b"}'),
    toolResult('[exit code: 1] bam', false), // v0/v3 wrapper
  ]
  const sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 2, 'one error per result, no double counting')
})

test('consecSameTool observes the trailing identical-tool run (no decision use)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('检查'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    v4ToolResult('ok', false, 'c1'),
    assistantCall('read', '{"p":"b"}'),
    v4ToolResult('ok', false, 'c2'),
    assistantCall('pwsh', '{"command":"x"}'),
    v4ToolResult('ok', false, 'c3'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.consecSameTool, 1, 'last call was pwsh, breaking the read run')
})
