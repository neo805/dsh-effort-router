/**
 * Engine-first acceptance tests for the 0.2.17 optimization review.
 *
 * These are semantic FR/NFR regressions, not performance micro-benchmarks:
 * multi-line brief ownership, unknown-effort ordering, whole-vector config
 * fallback, controlled word stems, resumed-task provenance, and blind-off
 * subagent-return signals. The current implementation is expected to fail the
 * affected assertions until the corresponding minimal production fixes land.
 */
import './test-profile.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSignals } from '../lib/signals.js'
import {
  classifyStep,
  normalizePolicyConfig,
  tokenEstimate,
} from '../lib/policy.js'
import { effortForRank, normalizeEfforts } from '../lib/routing.js'
import * as entry from '../lib/index.js'

const silentLogger = { info() {}, warn() {} }

function makeAgent(messages, id = 'optimization-engine') {
  return {
    sessionId: id,
    session: {
      id,
      header: {},
      deriveMessages: () => messages,
    },
  }
}

function makeSignals(cfg = {}) {
  return createSignals({
    config: () => normalizePolicyConfig(cfg),
    logger: silentLogger,
  })
}

const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const legacyToolResult = (text) => ({
  role: 'user',
  content: [{ type: 'tool-result', content: [{ type: 'text', text }] }],
})
const assistantCall = (name, args = '{}') => ({
  role: 'assistant',
  content: [{ type: 'reasoning', text: 'thinking' }, { type: 'tool-call', name, arguments: args }],
})
const v4ToolResult = (text, isError = false, callId = 'c1') => ({
  role: 'tool',
  toolCallId: callId,
  isError,
  source: { kind: 'tool', callId },
  content: [{ type: 'text', text }],
})
const subagentNotice = (text) => ({
  role: 'user',
  content: [{ type: 'text', text }],
  source: { kind: 'subagent-settled', form: 'notice' },
})

// ---- FR-010 / FR-013: one physical brief, one brief entry --------------------

test('multi-line claim/projection stays one brief and never resets an expired warm-up', () => {
  const text = '请重构这个模块的缓存\n补充 migration 与回归测试'
  const messages = []
  const agent = makeAgent(messages)
  const signals = makeSignals()
  signals.onClaimed({ agent, message: userMsg(text), turn: 4 })

  // The projection collect at step 5 reaches tick 4, one beyond warmUpSteps=3.
  // With the original claimTick=0 warm-up is expired; a duplicate reopen resets it.
  for (let step = 1; step <= 4; step += 1) signals.collect(agent, { turn: 4, step })
  messages.push(userMsg(text))
  const sig = signals.collect(agent, { turn: 4, step: 5 })

  assert.deepEqual({
    warmup: sig.warmup,
    raw: sig.briefVolumeRaw,
    effective: sig.briefVolume,
  }, {
    warmup: false,
    raw: sig.briefTokens,
    effective: sig.briefEffective,
  }, 'the projection is the same turn\'s second view: no reopen, no warm-up restart, no second copy')
})

test('the same brief text in different turns still contributes once per turn', () => {
  const text = '请重构这个模块的缓存\n补充回归测试'
  const messages = []
  const agent = makeAgent(messages)
  const signals = makeSignals()

  signals.onClaimed({ agent, message: userMsg(text), turn: 1 })
  messages.push(userMsg(text))
  const first = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(first.briefVolumeRaw, first.briefTokens, 'turn 1 contains exactly one copy')

  signals.onClaimed({ agent, message: userMsg(text), turn: 2 })
  const second = signals.collect(agent, { turn: 2, step: 1 })
  assert.equal(second.briefVolumeRaw, 2 * first.briefTokens,
    'dedupe is turn-scoped: turn 2 contributes its own single copy')
  assert.equal(second.briefVolume, 2 * first.briefEffective)
})

// ---- FR-017: unknown selectors have a strict, addressable total order --------

test('all-unknown efforts form a strict total order for 1/2/3/4/5/6/8 entries', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 8]) {
    const ids = Array.from({ length: count }, (_, index) => 'unknown-' + index)
    const { items, unknown } = normalizeEfforts(ids)
    assert.equal(items.length, count)
    assert.deepEqual(unknown, ids)
    assert.equal(items[0].rank, count === 1 ? 4 : 1)
    assert.equal(items[count - 1].rank, count === 1 ? 4 : 7)
    for (let index = 1; index < items.length; index += 1) {
      assert.ok(items[index].rank > items[index - 1].rank,
        count + ' entries collide at ' + items[index - 1].id + '/' + items[index].id
          + ' with rank ' + items[index].rank)
    }
  }
})

test('every unknown effort is exactly reachable by its own rank under every fallback', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 8]) {
    const ids = Array.from({ length: count }, (_, index) => 'unknown-' + index)
    const { items } = normalizeEfforts(ids)
    for (const fallback of ['nearest-up', 'up', 'down']) {
      const selected = items.map((item) => effortForRank(item.rank, ids, { fallback }).effort)
      assert.deepEqual(selected, ids,
        count + ' entries must not collapse during exact-rank selection (' + fallback + ')')
    }
  }
})

test('known anchors, duplicate removal, reserved ids, and the allow-list stay intact', () => {
  const levels = ['low', 'super', 'high', 'max', 'auto', 'low', 'super']
  const normalized = normalizeEfforts(levels)
  assert.deepEqual(normalized.items, [
    { id: 'low', rank: 2 },
    { id: 'super', rank: 3 },
    { id: 'high', rank: 4 },
    { id: 'max', rank: 6 },
  ])
  assert.deepEqual(normalized.unknown, ['super'])

  for (const fallback of ['nearest-up', 'up', 'down']) {
    const selected = effortForRank(3, levels, { allowedRanks: [3], fallback })
    assert.equal(selected.effort, 'super')
    assert.equal(selected.mapping, 'exact')
  }
  const unsupported = effortForRank(3, levels, { allowedRanks: [5] })
  assert.equal(unsupported.effort, undefined, 'an empty allow-list intersection fabricates nothing')
  assert.equal(unsupported.mapping, 'unsupported')
})

// ---- NFR-002 / NFR-005: malformed vectors fall back as a whole ---------------

function makeInterceptor(config) {
  const listeners = new Map()
  const infos = []
  const warnings = []
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return {
        reasoning: {
          efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id })),
        },
      }
    },
  }
  const ctx = {
    logger: () => ({ info: (m) => infos.push(m), warn: (m) => warnings.push(m) }),
    get(name) {
      if (name === 'llm') return llm
      throw new Error('no service ' + name)
    },
    on(event, handler) {
      listeners.set(event, handler)
      return () => {}
    },
    inject() { return () => {} },
  }
  entry.apply(ctx, config)
  const onRequest = listeners.get('agent/request')
  assert.equal(typeof onRequest, 'function', 'legacy request interceptor registered')
  return { onRequest, infos, warnings }
}

const autoSeed = () => async () => ({ provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
let vectorRun = 0

/** Observe the effective entry-string vector through the real scheduling path. */
async function runStringVector(key, value) {
  vectorRun += 1
  const { onRequest, warnings } = makeInterceptor(entry.Config({
    compressDiscount: false,
    warmUpSteps: 0,
    [key]: value,
  }))
  const sessionId = 'vector-' + key + '-' + vectorRun
  let out

  if (key === 'errorDecay') {
    const messages = [
      userMsg('今天天气怎么样'),
      assistantCall('read', '{"p":1}'),
      v4ToolResult('first failure', true, 'c1'),
    ]
    const agent = makeAgent(messages, sessionId)
    await onRequest({ agent, turn: 1, step: 1 }, autoSeed())
    messages.push(
      assistantCall('read', '{"p":2}'),
      v4ToolResult('second failure', true, 'c2'),
      v4ToolResult('third failure', true, 'c3'),
    )
    out = await onRequest({ agent, turn: 1, step: 2 }, autoSeed())
  } else {
    // tokenEstimate(text)=5. Custom rungs 1/4 therefore produce two volume
    // bumps; either shipped default produces none. Duplicate 1/1/4 produces
    // three, preserving the existing linear-ramp semantics through the string UI.
    const text = 'alpha beta gamma delta epsilon'
    const messages = [userMsg(text)]
    if (key === 'toolRamp') {
      messages.push(assistantCall('read', '{"p":"volume"}'), v4ToolResult(text, false, 'volume-c1'))
    }
    const agent = makeAgent(messages, sessionId)
    out = await onRequest({ agent, turn: 1, step: 1 }, autoSeed())
  }
  return { effort: out.reasoningEffort, warnings }
}

function hasVectorWarning(warnings, key) {
  return warnings.some((line) => line.includes(key) && /invalid|reject|fallback|default|poison/i.test(line))
}

const vectorFixtures = {
  // The malformed strings must fall back to the WHOLE shipped default. Under
  // the shipped decay weights the probe sequence scores 2.8 (one prior bucket
  // at 0.8 plus two fresh errors at 1 each), which already crosses the
  // onErrors*2 = 1.8 second rung: standard(low) + 2 -> high. (An earlier draft
  // of this fixture said "medium"; that arithmetic ignored the second rung and
  // contradicted the shipped 0.2.6 evidence contract in test/policy.test.mjs.)
  errorDecay: {
    invalidEffort: 'high',
    invalid: [['mixed', '1,x,0.5'], ['empty fragment', '1,,0.5'], ['all invalid', 'x,y'], ['negative', '1,-0.5']],
    cjk: ['0.5，0.5', 'high'],
  },
  briefRamp: {
    invalidEffort: 'low',
    invalid: [['mixed', '1,x,4'], ['empty fragment', '1,,4'], ['all invalid', 'x,y'], ['negative', '-1,4']],
    cjk: ['1、4', 'high'],
    duplicate: ['1,1,4', 'xhigh'],
  },
  toolRamp: {
    invalidEffort: 'low',
    invalid: [['mixed', '1,x,4'], ['empty fragment', '1,,4'], ['all invalid', 'x,y'], ['negative', '-1,4']],
    cjk: ['1；4', 'high'],
    duplicate: ['1,1,4', 'xhigh'],
  },
}

for (const [key, fixture] of Object.entries(vectorFixtures)) {
  for (const [name, value] of fixture.invalid) {
    test(`entry string ${key}: ${name} falls back whole and warns`, async () => {
      const { effort, warnings } = await runStringVector(key, value)
      assert.deepEqual(
        { effort, warned: hasVectorWarning(warnings, key) },
        { effort: fixture.invalidEffort, warned: true },
      )
    })
  }

  test(`entry string ${key}: CJK separators remain valid and silent`, async () => {
    const [value, expected] = fixture.cjk
    const { effort, warnings } = await runStringVector(key, value)
    assert.deepEqual(
      { effort, warned: hasVectorWarning(warnings, key) },
      { effort: expected, warned: false },
    )
  })

  if (fixture.duplicate) {
    test(`entry string ${key}: duplicate rungs preserve their exact linear-ramp behavior`, async () => {
      const [value, expected] = fixture.duplicate
      const { effort, warnings } = await runStringVector(key, value)
      assert.deepEqual(
        { effort, warned: hasVectorWarning(warnings, key) },
        { effort: expected, warned: false },
      )
    })
  }
}

// ---- FR-010: declared stems match derivatives; ordinary words keep boundaries

test('controlled engineering stems match both base and derived ordinary words', () => {
  const words = [
    'migrate', 'migration',
    'optimize', 'optimization',
    'diagnose', 'diagnosis',
    'integrate', 'integration',
  ]
  const cfg = normalizePolicyConfig({})
  const actual = words.map((text) => classifyStep({ text, toolCalls: 0 }, cfg).stepClass)
  assert.deepEqual(actual, words.map(() => 'engineering'))
})

test('ordinary cue boundaries reject capital/api, sparse/parse, and authority/auth false positives', () => {
  const cfg = normalizePolicyConfig({})
  for (const text of ['capital', 'sparse', 'authority']) {
    assert.equal(classifyStep({ text, toolCalls: 0 }, cfg).stepClass, 'standard')
  }
})

// ---- FR-010 / FR-014: resumed provenance and blind-off subagent signals ------

test('a genuine resumed user brief wins over later source-less tool-result text', () => {
  const brief = '帮我重构这个模块的缓存'
  const messages = [userMsg(brief), legacyToolResult('翻译这句话')]
  const sig = makeSignals().collect(makeAgent(messages), { turn: 3, step: 1 })
  assert.equal(sig.originClass, 'engineering')
  assert.equal(sig.briefTokens, tokenEstimate(brief))
  assert.equal(sig.briefVolumeRaw, tokenEstimate(brief), 'no tool-result text joins the brief volume')
})

test('subagentReturnBump=false clears off-period events and re-enabling does not replay them', () => {
  let cfg = normalizePolicyConfig({ subagentReturnBump: false })
  const signals = createSignals({ config: () => cfg, logger: silentLogger })
  const messages = []
  const agent = makeAgent(messages)

  assert.equal(signals.collect(agent, { turn: 1, step: 1 }).subagentReturn, 0)
  messages.push(subagentNotice('Background subagent 101 finished. Its closing message: done while off'))
  assert.equal(signals.collect(agent, { turn: 1, step: 2 }).subagentReturn, 0)

  cfg = normalizePolicyConfig({ subagentReturnBump: true })
  assert.equal(signals.collect(agent, { turn: 1, step: 3 }).subagentReturn, 0,
    'the return observed while disabled stays out of the re-enabled window')

  messages.push(subagentNotice('Background subagent 102 finished. Its closing message: done after re-enable'))
  assert.equal(signals.collect(agent, { turn: 1, step: 4 }).subagentReturn, 1,
    'a genuinely new return after re-enable still fires')
})
