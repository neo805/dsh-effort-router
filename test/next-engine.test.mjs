import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSignals } from '../lib/signals.js'
import { normalizePolicyConfig } from '../lib/policy.js'
import { effortForRank, normalizeEfforts } from '../lib/routing.js'

const FALLBACKS = ['nearest-up', 'up', 'down']
const silentLogger = { info() {}, warn() {} }

function idsOf(items) {
  return items.map((item) => item.id)
}

function strictOrderProblems(supported) {
  const { items } = normalizeEfforts(supported)
  const problems = []
  for (let index = 1; index < items.length; index += 1) {
    if (!(items[index - 1].rank < items[index].rank)) {
      problems.push(`${items[index - 1].id}@${items[index - 1].rank} !< ${items[index].id}@${items[index].rank}`)
    }
  }
  return problems
}

function exactRoutingProblems(supported) {
  const { items } = normalizeEfforts(supported)
  const problems = []
  for (const item of items) {
    for (const fallback of FALLBACKS) {
      const selected = effortForRank(item.rank, supported, { fallback })
      if (selected.effort !== item.id || selected.rank !== item.rank || selected.mapping !== 'exact') {
        problems.push({ target: item.id, fallback, selected })
      }
    }
  }
  return problems
}

const MIXED_BOUNDARIES = [
  ['a', 'b', 'low'],
  ['max', 'a', 'b'],
  ['a', 'b', 'minimal'],
  ['ultra', 'a', 'b'],
]

test('FR-017: mixed known/unknown boundary segments have a strict total order', () => {
  const failures = []
  for (const supported of MIXED_BOUNDARIES) {
    const problems = strictOrderProblems(supported)
    if (problems.length > 0) failures.push({ supported, problems })
  }
  assert.deepEqual(failures, [])
})

test('FR-017: every mixed known/unknown boundary id is exactly addressable under every fallback', () => {
  const failures = []
  for (const supported of MIXED_BOUNDARIES) {
    const problems = exactRoutingProblems(supported)
    if (problems.length > 0) failures.push({ supported, problems })
  }
  assert.deepEqual(failures, [])
})

test('FR-017: duplicate ids keep first position and known anchors retain advertised order', () => {
  const supported = ['minimal', 'a', 'low', 'a', 'high', 'b', 'ultra', 'b']
  const { items } = normalizeEfforts(supported)
  assert.deepEqual(idsOf(items), ['minimal', 'a', 'low', 'high', 'b', 'ultra'])
  assert.deepEqual(strictOrderProblems(supported), [])
  assert.deepEqual(exactRoutingProblems(supported), [])
  assert.deepEqual(
    items.filter((item) => ['minimal', 'low', 'high', 'ultra'].includes(item.id)).map((item) => item.id),
    ['minimal', 'low', 'high', 'ultra'],
  )
})

test('FR-017: mixed-vector allow-list is an exact final intersection, including empty', () => {
  const supported = ['minimal', 'a', 'low', 'high', 'b', 'ultra']
  const { items } = normalizeEfforts(supported)
  const allowedIds = new Set(['a', 'high', 'b'])
  const allowedRanks = items.filter((item) => allowedIds.has(item.id)).map((item) => item.rank)

  for (const item of items) {
    for (const fallback of FALLBACKS) {
      const selected = effortForRank(item.rank, supported, { fallback, allowedRanks })
      assert.ok(allowedIds.has(selected.effort), `${item.id} escaped the allow-list via ${fallback}`)
      if (allowedIds.has(item.id)) {
        assert.equal(selected.effort, item.id)
        assert.equal(selected.mapping, 'exact')
      }
    }
  }

  for (const fallback of FALLBACKS) {
    assert.deepEqual(effortForRank(items[0].rank, supported, { fallback, allowedRanks: [] }), {
      effort: undefined,
      rank: null,
      mapping: 'unsupported',
      unknown: ['a', 'b'],
    })
  }
})

test('FR-017: nearest-up/up/down keep midpoint and boundary contracts on mixed vectors', () => {
  const supported = ['minimal', 'a', 'low', 'high', 'b', 'ultra']
  const { items } = normalizeEfforts(supported)
  const lower = items.find((item) => item.id === 'low')
  const upper = items.find((item) => item.id === 'high')
  const midpoint = (lower.rank + upper.rank) / 2

  assert.equal(effortForRank(midpoint, supported, { fallback: 'nearest-up' }).effort, 'high')
  assert.equal(effortForRank(midpoint, supported, { fallback: 'up' }).effort, 'high')
  assert.equal(effortForRank(midpoint, supported, { fallback: 'down' }).effort, 'low')

  const first = items[0]
  const last = items[items.length - 1]
  for (const fallback of FALLBACKS) {
    assert.equal(effortForRank(first.rank - 0.25, supported, { fallback }).effort, first.id)
    assert.equal(effortForRank(last.rank + 0.25, supported, { fallback }).effort, last.id)
  }
})

function makeAgent(messages, id) {
  return {
    sessionId: id,
    session: {
      id,
      header: {},
      deriveMessages: () => messages,
    },
  }
}

function makeSignals() {
  return createSignals({
    config: () => normalizePolicyConfig({}),
    logger: silentLogger,
  })
}

function userMsg(text) {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function briefSnapshot(sig) {
  return {
    originClass: sig.originClass,
    warmup: sig.warmup,
    raw: sig.briefVolumeRaw,
    effective: sig.briefVolume,
    currentTokens: sig.briefTokens,
    currentEffective: sig.briefEffective,
  }
}

const MULTILINE = '请重构这个模块的缓存\n补充 migration 与回归测试'

function collectClaimOrder(order) {
  const messages = [userMsg(MULTILINE)]
  const agent = makeAgent(messages, `brief-order-${order}`)
  const signals = makeSignals()
  const message = messages[0]
  if (order === 'claimed-first') signals.onClaimed({ agent, message, turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  if (order === 'projection-first') signals.onClaimed({ agent, message, turn: 1 })
  return signals.collect(agent, { turn: 1, step: 2 })
}

test('FR-010/FR-013: one physical multiline brief is identical in both claim/projection orders', () => {
  const claimedFirst = collectClaimOrder('claimed-first')
  const projectionFirst = collectClaimOrder('projection-first')
  assert.equal(claimedFirst.briefVolumeRaw, claimedFirst.briefTokens, 'control: claimed-first counts one copy')
  assert.deepEqual(briefSnapshot(projectionFirst), briefSnapshot(claimedFirst))
})

test('FR-010/FR-013: a late claim matching an old projection neither doubles volume nor restarts warm-up', () => {
  const messages = [userMsg(MULTILINE)]
  const agent = makeAgent(messages, 'brief-order-expired')
  const signals = makeSignals()
  for (let step = 1; step <= 4; step += 1) signals.collect(agent, { turn: 4, step })

  signals.onClaimed({ agent, message: messages[0], turn: 4 })
  const sig = signals.collect(agent, { turn: 4, step: 5 })
  assert.equal(sig.warmup, false)
  assert.equal(sig.briefVolumeRaw, sig.briefTokens)
  assert.equal(sig.briefVolume, sig.briefEffective)
})

test('FR-013: two real identical claims in one turn still contribute two briefs', () => {
  const messages = []
  const agent = makeAgent(messages, 'brief-same-turn-twice')
  const signals = makeSignals()
  const message = userMsg(MULTILINE)
  signals.onClaimed({ agent, message, turn: 1 })
  signals.onClaimed({ agent, message: userMsg(MULTILINE), turn: 1 })
  messages.push(message, userMsg(MULTILINE))

  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.briefVolumeRaw, 2 * sig.briefTokens)
  assert.equal(sig.briefVolume, 2 * sig.briefEffective)
})

test('FR-013: identical claims in different turns still contribute once per turn', () => {
  const messages = []
  const agent = makeAgent(messages, 'brief-different-turns')
  const signals = makeSignals()
  const message = userMsg(MULTILINE)
  signals.onClaimed({ agent, message, turn: 1 })
  const first = signals.collect(agent, { turn: 1, step: 1 })
  signals.onClaimed({ agent, message: userMsg(MULTILINE), turn: 2 })
  const second = signals.collect(agent, { turn: 2, step: 1 })

  assert.equal(first.briefVolumeRaw, first.briefTokens)
  assert.equal(second.briefVolumeRaw, 2 * first.briefTokens)
  assert.equal(second.briefVolume, 2 * first.briefEffective)
})

function oldBranchMessages() {
  return [
    { role: 'user', content: '今天天气怎么样' },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'tool-call', name: 'bash', arguments: '{"path":"old"}' },
      ],
    },
    {
      role: 'tool',
      toolCallId: 'old-call',
      isError: true,
      source: { kind: 'tool', callId: 'old-call' },
      content: [{ type: 'text', text: '[exit code: 9] old branch failure' }],
    },
  ]
}

function replacementBranchMessages(length) {
  const messages = [{ role: 'user', content: '请重构这个模块的缓存并补充回归测试' }]
  while (messages.length < length) {
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: `new branch message ${messages.length}` }],
    })
  }
  return messages
}

function branchEvidenceSnapshot(sig) {
  return {
    originClass: sig.originClass,
    briefRaw: sig.briefVolumeRaw,
    briefEffective: sig.briefVolume,
    errors: sig.taskErrors,
    repeats: sig.taskRepeats,
    toolRaw: sig.toolVolumeRaw,
    toolEffective: sig.toolVolume,
    toolCalls: sig.toolCalls,
  }
}

for (const [label, replacementLength] of [['shorter', 1], ['equal-length', 3], ['longer', 5]]) {
  test(`FR-044: replaceGeneration resets old evidence after a ${label} projection rewrite`, () => {
    const oldMessages = oldBranchMessages()
    const agent = makeAgent(oldMessages, `branch-${label}`)
    agent.session.surface = { replaceGeneration: 0 }
    const signals = makeSignals()
    const before = signals.collect(agent, { turn: 1, step: 1 })
    assert.equal(before.taskErrors, 1)
    assert.ok(before.briefVolumeRaw > 0)
    assert.ok(before.toolVolumeRaw > 0)

    const replacement = replacementBranchMessages(replacementLength)
    agent.session.deriveMessages = () => replacement
    agent.session.surface.replaceGeneration = 1
    const after = signals.collect(agent, { turn: 2, step: 1 })

    assert.equal(after.originClass, 'engineering')
    assert.equal(after.briefVolumeRaw, after.briefTokens)
    assert.equal(after.briefVolume, after.briefEffective)
    assert.equal(after.taskErrors, 0)
    assert.equal(after.weightedErrors, 0)
    assert.equal(after.taskRepeats, 0)
    assert.equal(after.toolVolumeRaw, 0)
    assert.equal(after.toolVolume, 0)
    assert.equal(after.toolCalls, 0)
  })
}

test('FR-044: an ordinary same-generation shrink does not clear evidence by length', () => {
  const messages = oldBranchMessages()
  const agent = makeAgent(messages, 'branch-compaction-control')
  agent.session.surface = { replaceGeneration: 7 }
  const signals = makeSignals()
  const before = signals.collect(agent, { turn: 1, step: 1 })

  const compacted = [{ role: 'assistant', content: [{ type: 'text', text: 'summary' }] }]
  agent.session.deriveMessages = () => compacted
  const after = signals.collect(agent, { turn: 1, step: 2 })
  assert.deepEqual(branchEvidenceSnapshot(after), branchEvidenceSnapshot(before))
})
