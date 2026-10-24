/**
 * policy.js unit tests — origin cue pipeline (dictionary/shape), wish floor,
 * drift composition (stacked channels, freshness-aware rungs, linear ramps,
 * warm-up floor, trivial lift cap), frugal demote, clamps.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLICY_DEFAULTS,
  classifyStep,
  decideEffort,
  decayThreshold,
  demoteClass,
  errorTextMatches,
  errorTextSource,
  escalateClass,
  evidenceBumps,
  isPlanLike,
  isStructural,
  normalizePolicyConfig,
  rampBumps,
  stableStringify,
  textOfContent,
  tokenEstimate,
  tokenEstimateBlocks,
  toolErrorOfMessage,
  toolErrorsOf,
  toolCallWithoutReasoning,
  toolCallsOf,
} from '../lib/policy.js'

const cfg = normalizePolicyConfig({})

test('classifyStep: cheap intent, short step -> trivial', () => {
  const r = classifyStep({ text: '翻译这句话', toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'trivial')
})

test('classifyStep: plain short question -> standard', () => {
  const r = classifyStep({ text: '今天天气怎么样', toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'standard')
})

test('classifyStep: engineering cue -> engineering', () => {
  const r = classifyStep({ text: '重构这个模块的缓存层', toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'engineering')
})

test('classifyStep: structural text -> engineering', () => {
  const r = classifyStep({ text: '看看这段代码\n```js\nconst a = 1\n```', toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'engineering')
})

test('isStructural: a spaced arrow function is still code', () => {
  assert.equal(isStructural('f = (x) => x + 1', 'f = (x) => x + 1'), true)
  assert.equal(isStructural('f=(x)=>x+1', 'f=(x)=>x+1'), true)
  assert.equal(isStructural('普通说明文字，没有代码', '普通说明文字，没有代码'), false)
})

test('classifyStep: dense engineering brief with structure -> hard', () => {
  const text = '重构 架构 设计 迁移 优化 性能 并发 调试 诊断 实现 集成\n```js\nclass A {}\n```'
  const r = classifyStep({ text, toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'hard')
})

test('classifyStep: tool activity is not an input anymore (origin = brief only)', () => {
  // 0.2.8: classification happens once at the task origin, before any tool
  // call exists — the old toolCallClass floor is gone with it.
  const r = classifyStep({ text: '看一下这个文件' }, cfg)
  assert.equal(r.stepClass, 'standard')
})

test('word boundaries: english prose no longer steals strong hits', () => {
  // capital⊃api, author⊃auth, sparse⊃parse under substring matching — all gone now
  const r = classifyStep({ text: 'Tell me about the capital and its famous authors', toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'standard')
  // a real cue on a word boundary still hits
  const hit = classifyStep({ text: 'Please refactor the parser', toolCalls: 0 }, cfg)
  assert.equal(hit.stepClass, 'engineering')
})

test('wish floor: vacuum-zone delegation brief starts at engineering', () => {
  const r = classifyStep({ text: '帮我做个淘宝', toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'engineering')
  assert.ok(r.reason.join().includes('wish'))
})

test('wish floor: positive cues suppress the detector', () => {
  // cheap cue present -> trivial, wish never fires
  const cheap = classifyStep({ text: '帮我改个错别字', toolCalls: 0 }, cfg)
  assert.equal(cheap.stepClass, 'trivial')
  // strong cue present -> engineering via the strong rule, not the wish floor
  const strong = classifyStep({ text: '帮我重构这个模块', toolCalls: 0 }, cfg)
  assert.equal(strong.stepClass, 'engineering')
  assert.ok(!strong.reason.join().includes('wish'))
  // detector disabled -> vacuum-zone wish brief falls back to standard
  const off = normalizePolicyConfig({ wish: false })
  assert.equal(classifyStep({ text: '帮我做个淘宝', toolCalls: 0 }, off).stepClass, 'standard')
  // a long brief is not underspecified: the token cap holds it at standard
  const long = classifyStep({ text: '帮我 ' + '分析'.repeat(80), toolCalls: 0 }, cfg)
  assert.equal(long.stepClass, 'standard')
})

test('decideEffort: routes table drives the tier', () => {
  assert.equal(decideEffort(cfg, { originClass: 'trivial' }).tier, 'low')
  assert.equal(decideEffort(cfg, { originClass: 'engineering' }).tier, 'high')
})

test('decideEffort: hard routes to max by default; opt-out clamps to fallback', () => {
  const d = decideEffort(cfg, { originClass: 'hard' })
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.tier, 'max') // allowMax defaults to true (0.2.0)
  const noMax = normalizePolicyConfig({ allowMax: false })
  const clamped = decideEffort(noMax, { originClass: 'hard' })
  assert.equal(clamped.tier, 'high')
  assert.ok(clamped.reason.join().includes('max is opt-out'))
})

test('decideEffort: error-channel evidence lifts the class, capped at the ceiling', () => {
  // weightedErrors 1.8 = two fresh errors under the default decay -> +2
  const d = decideEffort(cfg, { originClass: 'standard', weightedErrors: 1.8 })
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.tier, 'max')
  // the channel cap (maxEscalations) binds evidence + todo + carry together
  const capped = decideEffort(cfg, { originClass: 'standard', weightedErrors: 9, todoBump: 1, carry: 1 })
  assert.equal(capped.stepClass, 'hard', 'standard +2 (channel cap) -> hard, not beyond')
  assert.ok(capped.reason.join().includes('error channel capped'))
})

test('decideEffort: carry lifts the origin one class', () => {
  const d = decideEffort(cfg, { originClass: 'engineering', carry: 1 })
  assert.equal(d.stepClass, 'hard')
})

test('decideEffort: subagent/compaction events stack in channel ① and share its cap (0.2.9)', () => {
  const sub = decideEffort(cfg, { originClass: 'engineering', subagentReturn: 1 })
  assert.equal(sub.stepClass, 'hard')
  assert.ok(sub.reason.join().includes('subagent returned +1'))
  const comp = decideEffort(cfg, { originClass: 'standard', compaction: 1 })
  assert.equal(comp.stepClass, 'engineering')
  assert.ok(comp.reason.join().includes('context compacted +1'))
  // All three events + evidence together still stop at maxEscalations.
  const capped = decideEffort(cfg, {
    originClass: 'standard', weightedErrors: 9, subagentReturn: 1, compaction: 1, todoBump: 1,
  })
  assert.equal(capped.stepClass, 'hard', 'standard +2 (channel cap) -> hard, not beyond')
  assert.ok(capped.reason.join().includes('error channel capped'))
})

test('decideEffort: volume reads linear ramps; channels STACK (0.2.8)', () => {
  // brief >400 -> +1: standard -> engineering
  const brief1 = decideEffort(cfg, { originClass: 'standard', briefVolume: 500 })
  assert.equal(brief1.stepClass, 'engineering')
  assert.ok(brief1.reason.join().includes('brief volume'))
  // brief >1600 -> +2: standard -> hard
  const brief2 = decideEffort(cfg, { originClass: 'standard', briefVolume: 1700 })
  assert.equal(brief2.stepClass, 'hard')
  // tool window >48000 -> +1
  const tool1 = decideEffort(cfg, { originClass: 'standard', toolVolume: 50000 })
  assert.equal(tool1.stepClass, 'engineering')
  // the louder of the two ramps speaks (brief +2 vs tool +1)
  const louder = decideEffort(cfg, { originClass: 'standard', briefVolume: 1700, toolVolume: 50000 })
  assert.equal(louder.stepClass, 'hard')
  // 0.2.8: channels STACK — evidence +2 AND tool volume +2 lift +4 (ceiling hard)
  const stacked = decideEffort(cfg, { originClass: 'standard', weightedErrors: 1.8, toolVolume: 130000 })
  assert.equal(stacked.stepClass, 'hard')
  assert.ok(stacked.reason.join().includes('lift +4'), 'the drift sum is reported: ' + stacked.reason.join())
  // a trivial origin caps the TOTAL lift at trivialLiftCap (default 1)
  const cappedLift = decideEffort(cfg, { originClass: 'trivial', briefVolume: 5000, toolVolume: 200000 })
  assert.equal(cappedLift.stepClass, 'standard')
  assert.ok(cappedLift.reason.join().includes('trivial origin'))
})

test('decideEffort: the warm-up floor holds the origin against frugal', () => {
  const held = decideEffort(cfg, { originClass: 'engineering', frugal: true, frugalWhy: 'subagent', warmup: true })
  assert.equal(held.stepClass, 'engineering', 'frugal cannot undercut a fresh task')
  assert.ok(held.reason.join().includes('warm-up'))
  const released = decideEffort(cfg, { originClass: 'engineering', frugal: true, frugalWhy: 'subagent', warmup: false })
  assert.equal(released.stepClass, 'standard', 'after the warm-up, drift owns the level')
})

test('evidenceBumps: freshness-aware rungs under decay weights (0.2.8)', () => {
  assert.equal(evidenceBumps(0, 0, cfg), 0)
  assert.equal(evidenceBumps(1, 0, cfg), 1) // 0.2.6 (audit R4.1): the FIRST error lifts one class
  assert.equal(evidenceBumps(1.8, 0, cfg), 2) // two FRESH errors reach the +2 rung (1 + 0.8)
  assert.equal(evidenceBumps(0.8, 0, cfg), 0) // one stale error is discounted away
  assert.equal(evidenceBumps(4, 0, cfg), 2) // capped by maxEscalations
  assert.equal(evidenceBumps(0, 2.4, cfg), 1) // three fresh repeats (1 + 0.8 + 0.6)
  assert.equal(evidenceBumps(0, 1.8, cfg), 0) // two fresh repeats are not three
  assert.equal(evidenceBumps(9, 9, normalizePolicyConfig({ maxEscalations: 1 })), 1)
  // flat weights reproduce the pre-0.2.8 thresholds exactly
  const flat = normalizePolicyConfig({ errorDecay: [1, 1, 1, 1, 1, 1] })
  assert.equal(evidenceBumps(2, 0, flat), 2)
  assert.equal(evidenceBumps(0, 3, flat), 1)
})

test('rampBumps: one bump per rung exceeded', () => {
  assert.equal(rampBumps(0, [400, 1600]), 0)
  assert.equal(rampBumps(400, [400, 1600]), 0)
  assert.equal(rampBumps(401, [400, 1600]), 1)
  assert.equal(rampBumps(1700, [400, 1600]), 2)
  assert.equal(rampBumps(99999, []), 0)
  assert.equal(rampBumps(500, undefined), 0)
})

test('decayThreshold: the N freshest weights (flat = exactly N)', () => {
  assert.equal(decayThreshold([1, 0.8, 0.6, 0.5, 0.4, 0.3], 1), 1)
  assert.equal(decayThreshold([1, 0.8, 0.6, 0.5, 0.4, 0.3], 2), 1.8)
  assert.equal(decayThreshold([1, 0.8, 0.6, 0.5, 0.4, 0.3], 3), 2.4)
  assert.equal(decayThreshold([1, 1, 1], 3), 3)
  assert.equal(decayThreshold([0.5], 3), 1.5, 'ages beyond the array reuse its last value')
})

test('normalizePolicyConfig: ramp/decay vectors sanitize element-wise', () => {
  const c = normalizePolicyConfig({ briefRamp: [1600, 400], errorDecay: [1, 'x', 0.5] })
  assert.deepEqual(c.briefRamp, [400, 1600], 'rungs sort ascending')
  assert.deepEqual(c.errorDecay, POLICY_DEFAULTS.errorDecay, 'a poisoned vector falls back whole')
  const bad = normalizePolicyConfig({ toolRamp: [-1, 0] })
  assert.deepEqual(bad.toolRamp, POLICY_DEFAULTS.toolRamp)
})

test('decideEffort: frugal signal demotes one class', () => {
  const d = decideEffort(cfg, { originClass: 'engineering', frugal: true, frugalWhy: 'subagent' })
  assert.equal(d.stepClass, 'standard')
  assert.equal(d.tier, 'low')
  assert.ok(d.reason.join().includes('frugal'))
  const off = normalizePolicyConfig({ frugalDemote: false })
  assert.equal(decideEffort(off, { originClass: 'engineering', frugal: true }).tier, 'high')
})

test('decideEffort: poisoned history pins off', () => {
  const d = decideEffort(cfg, { originClass: 'engineering', poisonedHistory: true })
  assert.equal(d.tier, 'off')
  assert.equal(d.poisoned, true)
})

test('decideEffort: a route of off can never be emitted (rule 4)', () => {
  const weird = normalizePolicyConfig({})
  weird.routes = { trivial: 'off', standard: 'off', engineering: 'off', hard: 'off' }
  const d = decideEffort(weird, { originClass: 'trivial' })
  assert.equal(d.tier, 'low')
})

test('normalizePolicyConfig: invalid route values fall back', () => {
  const c = normalizePolicyConfig({ routes: { trivial: 'max', standard: 'nonsense' } })
  assert.equal(c.routes.trivial, 'max')
  assert.equal(c.routes.standard, 'low')
  assert.equal(c.routes.engineering, 'high')
})

test('normalizePolicyConfig: user cues merge on top of the shipped dictionaries', () => {
  const c = normalizePolicyConfig({ extraCues: { strong: ['blorf'], wish: ['琢磨琢磨'] } })
  assert.equal(classifyStep({ text: 'blorf this module', toolCalls: 0 }, c).stepClass, 'engineering')
  assert.equal(classifyStep({ text: '琢磨琢磨这个事', toolCalls: 0 }, c).stepClass, 'engineering')
  // full replacement still works for programmatic callers
  const replaced = normalizePolicyConfig({ strong: ['onlycue'] })
  assert.deepEqual(replaced.strong, ['onlycue'])
  assert.equal(classifyStep({ text: '重构这个模块', toolCalls: 0 }, replaced).stepClass, 'standard')
})

test('normalizePolicyConfig: dictionaries channel replaces the shipped list, additions still merge', () => {
  // Full replacement through the config-file channel: the user's list IS the
  // dictionary — a shipped cue no longer matches (deletion works)...
  const replaced = normalizePolicyConfig({ dictionaries: { strong: ['myowncue'] } })
  assert.deepEqual(replaced.strong, ['myowncue'])
  assert.equal(classifyStep({ text: 'myowncue the parser', toolCalls: 0 }, replaced).stepClass, 'engineering')
  assert.equal(classifyStep({ text: '重构这个模块', toolCalls: 0 }, replaced).stepClass, 'standard')
  // ...while cues* additions merge ON TOP of the replacement, like they do on
  // top of the shipped list.
  const composed = normalizePolicyConfig({
    dictionaries: { strong: ['myowncue'] },
    extraCues: { strong: ['blorf'] },
  })
  assert.deepEqual(composed.strong, ['myowncue', 'blorf'])
  // Untouched lists keep the shipped dictionary.
  assert.ok(composed.normal.length > 1)
  // The wish boolean flag survives a dictionary replacement (name clash guard).
  const wishOff = normalizePolicyConfig({ wish: false, dictionaries: { wish: ['琢磨琢磨'] } })
  assert.equal(wishOff.wishEnabled, false)
  assert.deepEqual(wishOff.wish, ['琢磨琢磨'])
  const wishOn = normalizePolicyConfig({ dictionaries: { wish: ['琢磨琢磨'] } })
  assert.equal(wishOn.wishEnabled, true)
})

test('normalizePolicyConfig: additive cues also apply to a programmatic full replacement', () => {
  const c = normalizePolicyConfig({ strong: ['base'], extraCues: { strong: ['extra'] } })
  assert.deepEqual(c.strong, ['base', 'extra'])
})

test('escalateClass/demoteClass ladder', () => {
  assert.equal(escalateClass('trivial', 1), 'standard')
  assert.equal(escalateClass('standard', 5), 'hard') // capped at ceiling
  assert.equal(demoteClass('hard'), 'engineering')
  assert.equal(demoteClass('trivial'), 'trivial')
})

test('toolCallWithoutReasoning / toolErrorsOf', () => {
  const poisoned = [{ type: 'tool-call', name: 'read', arguments: '{}' }]
  assert.equal(toolCallWithoutReasoning(poisoned), true)
  assert.equal(toolCallWithoutReasoning([{ type: 'reasoning' }, ...poisoned]), false)
  const results = [{ type: 'tool-result', isError: true, content: 'x' }, { type: 'tool-result', content: 'ok' }]
  assert.equal(toolErrorsOf(results), 1)
})

test('errorTextMatches: the 0.2.6 marker set (audit R2 / §4.3)', () => {
  // hard markers
  assert.equal(errorTextMatches('boom\n[exit code: 1]'), true)
  assert.equal(errorTextMatches('Exit Code: 127\n'), true)
  assert.equal(errorTextMatches('stdout:\nTraceback (most recent call last)'), true)
  assert.equal(errorTextMatches('\nException'), true)
  assert.equal(errorTextMatches('stderr: FATAL\n'), true)
  assert.equal(errorTextMatches('\n错误: 文件不存在'), true)
  assert.equal(errorTextMatches('失败 3 次'), true)
  // demotions / non-hits
  assert.equal(errorTextMatches(''), false)
  assert.equal(errorTextMatches('执行成功，没有错误'), false) // prose, no colon/digit/EOL anchor
  assert.equal(errorTextMatches('错误已恢复\n[exit code: 0]'), false) // exit-0 demotion on CJK-only hit
  assert.equal(errorTextMatches('[exit code: 0] 失败\n[exit code: 1]'), true) // a real failure marker wins
  assert.equal(errorTextMatches('all good'), false)
})

test('errorTextSource: the decision log can tell every failure channel apart', () => {
  assert.equal(errorTextSource('[exit code: 1]'), 'exit-bracket')
  assert.equal(errorTextSource('\nExit Code: 2\n'), 'exit-line')
  assert.equal(errorTextSource('Traceback (most recent call last)'), 'en')
  assert.equal(errorTextSource('错误: boom'), 'cjk')
  assert.equal(errorTextSource('错误\n[exit code: 0]'), 'cjk-downgraded')
  assert.equal(errorTextSource('Stdout: Traceback (most recent call last)\n[exit code: 0]'), 'exit0-traceback')
  assert.equal(errorTextSource('all good'), null)
  // Existing boolean semantics are unchanged.
  assert.equal(errorTextMatches('错误\n[exit code: 0]'), false)
})

test('toolErrorOfMessage: the v4 first-class tool message', () => {
  const v4 = (text, isError) => ({
    role: 'tool', toolCallId: 'c1', isError, source: { kind: 'tool', callId: 'c1' },
    content: [{ type: 'text', text }],
  })
  assert.equal(toolErrorOfMessage(v4('anything', true)), 1)
  assert.equal(toolErrorOfMessage(v4('done\n[exit code: 1]', false)), 1)
  assert.equal(toolErrorOfMessage(v4('ok', false)), 0)
  assert.equal(toolErrorOfMessage(null), 0)
  assert.equal(toolErrorOfMessage({ role: 'tool', content: 'plain string content [exit code: 2]' }), 1)
})

test('stableStringify / toolCallsOf: argument key order cannot hide a repeat (audit R4.6)', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
  const callA = toolCallsOf([{ type: 'tool-call', name: 'read', arguments: '{"x":1,"y":2}' }])
  const callB = toolCallsOf([{ type: 'tool-call', name: 'read', arguments: '{"y":2,"x":1}' }])
  assert.equal(callA[0].key, callB[0].key, 'same arguments, different key order -> same repeat key')
  const callC = toolCallsOf([{ type: 'tool-call', name: 'read', arguments: '{"x":1,"y":3}' }])
  assert.notEqual(callA[0].key, callC[0].key)
  const callRaw = toolCallsOf([{ type: 'tool-call', name: 'read', arguments: 'not json at all' }])
  assert.equal(callRaw[0].key, 'read|not json at all', 'unparsable args keep their raw spelling')
})

test('toolCallsOf: long arguments that differ only after 400 chars are different calls', () => {
  // Regression: the prefix-only truncation collapsed both writes to one key,
  // so three distinct large edits could masquerade as an identical retry loop.
  const prefix = 'x'.repeat(450)
  const first = toolCallsOf([{ type: 'tool-call', name: 'write', arguments: JSON.stringify({ text: prefix + '-A' }) }])[0]
  const second = toolCallsOf([{ type: 'tool-call', name: 'write', arguments: JSON.stringify({ text: prefix + '-B' }) }])[0]
  assert.notEqual(first.key, second.key, 'the complete canonical argument spelling is the identity')

  // The same arguments still agree across object / JSON-string input and key order.
  const objectCall = toolCallsOf([{ type: 'tool-call', name: 'edit', arguments: { a: 1, b: 2 } }])[0]
  const stringCall = toolCallsOf([{ type: 'tool-call', name: 'edit', arguments: '{"b":2,"a":1}' }])[0]
  assert.equal(objectCall.key, stringCall.key)
})

test('T6 dictionaries (0.2.6, audit R3): migrations and additions', () => {
  // additions: heavy-leaning CJK gaps now strong cues
  for (const text of ['帮我做个计划', '搜索一下这个报错', '评估这个方案', '开发环境搭一下']) {
    assert.equal(classifyStep({ text, toolCalls: 0 }, cfg).stepClass, 'engineering', text)
  }
  // migrations: api/依赖/异常 are normal cues now — no engineering floor
  assert.equal(classifyStep({ text: '这个 api 怎么用', toolCalls: 0 }, cfg).stepClass, 'standard')
  assert.equal(classifyStep({ text: '依赖版本是多少', toolCalls: 0 }, cfg).stepClass, 'standard')
  // cheap privilege revoked: “一句话” no longer pins trivial
  assert.equal(classifyStep({ text: '用一句话总结这篇论文', toolCalls: 0 }, cfg).stepClass, 'standard')
  // new cheap cues: output-format instructions stay trivial
  assert.equal(classifyStep({ text: 'return only the bullet points', toolCalls: 0 }, cfg).stepClass, 'trivial')
})

test('trivialTokenCap 200 (0.2.6, audit R4.4): trivial pastes keep their class', () => {
  const paste = '翻译一下这句话 ' + 'word '.repeat(150) // ~150 tokens, cheap intent
  assert.equal(classifyStep({ text: paste, toolCalls: 0 }, cfg).stepClass, 'trivial')
})

// --- token counting (0.2.7 hot-path rework: single pass, block folding) ----

/** The pre-0.2.7 two-pass implementation, kept here as the equivalence oracle. */
function legacyTokenEstimate(text) {
  const latin = (text.match(/[A-Za-z0-9_'-]+/g) || []).length
  let cjk = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) cjk += 1
  }
  return latin + cjk
}

/** Deterministic PRNG so a failure prints a reproducible seed. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('tokenEstimate: single-pass rewrite equals the legacy two-pass counter', () => {
  // targeted edges first
  const edges = [
    '', ' ', "don't stop", 'kebab-case_word', "''--__", '一', '文字列テスト',
    'a一b', '一a二', 'abc123', '123', '-leading', 'trailing-', '中　全角空格',
    'emoji 😀 mix', '䶿 compat 欄', "rock'n'roll", 'a\u0000b',
  ]
  for (const s of edges) {
    assert.equal(tokenEstimate(s), legacyTokenEstimate(s), JSON.stringify(s))
  }
  // then a seeded fuzz over latin/CJK/punct/surrogate soup
  const rand = mulberry32(20261010)
  const pools = [
    () => String.fromCharCode(0x61 + Math.floor(rand() * 26)), // a-z
    () => String.fromCharCode(0x41 + Math.floor(rand() * 26)), // A-Z
    () => String.fromCharCode(0x30 + Math.floor(rand() * 10)), // 0-9
    () => "_'- "[Math.floor(rand() * 4)], // latin-class extras + space
    () => String.fromCharCode(0x4e00 + Math.floor(rand() * 0x2000)), // CJK
    () => String.fromCharCode(0xf900 + Math.floor(rand() * 0x100)), // compat
    () => '，。！？、；：,.!?;: \n\t'[Math.floor(rand() * 16)], // punct
    () => '😀🎉🚀'[Math.floor(rand() * 6)], // surrogate halves
  ]
  for (let iter = 0; iter < 300; iter += 1) {
    const len = Math.floor(rand() * 120)
    let s = ''
    for (let i = 0; i < len; i += 1) s += pools[Math.floor(rand() * pools.length)]()
    assert.equal(tokenEstimate(s), legacyTokenEstimate(s), 'fuzz #' + iter + ' ' + JSON.stringify(s))
  }
})

test('tokenEstimateBlocks: equals tokenEstimate(textOfContent(...)) block for block', () => {
  const cases = [
    undefined,
    null,
    'plain string content',
    [],
    [{ type: 'text', text: 'one block' }],
    // latin run spanning the block boundary: concat counts "abcdef" once
    [{ type: 'text', text: 'abc' }, { type: 'text', text: 'def' }],
    // image placeholder breaks the run: "abc [image] def" -> 3 tokens
    [{ type: 'text', text: 'abc' }, { type: 'image' }, { type: 'text', text: 'def' }],
    // nested tool-result recursion, CJK/latin mix
    [{ type: 'tool-result', content: [{ type: 'text', text: '结果: ok ' }, 'raw piece', 42, null] }],
    [{ type: 'text', text: 'prefix ' }, { type: 'tool-result', content: 'tail 文字' }],
    // non-text parts contribute nothing
    [{ type: 'tool-call', name: 'read', arguments: '{"x":1}' }, { type: 'text' }, null, 'tail'],
    [{ type: 'text', text: '' }, { type: 'image' }, { type: 'image' }],
  ]
  for (const content of cases) {
    assert.equal(
      tokenEstimateBlocks(content),
      tokenEstimate(textOfContent(content)),
      JSON.stringify(content),
    )
  }
  // and a seeded fuzz over random block lists
  const rand = mulberry32(81027)
  const piece = () => {
    const kind = Math.floor(rand() * 6)
    if (kind === 0) return null
    if (kind === 1) return 42
    if (kind === 2) return 'raw' + Math.floor(rand() * 100)
    if (kind === 3) return { type: 'text', text: '块' + Math.floor(rand() * 100) + ' abc' }
    if (kind === 4) return { type: 'image' }
    return { type: 'tool-result', content: rand() < 0.5 ? 'inner 结果 ' + Math.floor(rand() * 100) : [{ type: 'text', text: 'nested tail' }] }
  }
  for (let iter = 0; iter < 200; iter += 1) {
    const n = Math.floor(rand() * 6)
    const content = Array.from({ length: n }, piece)
    assert.equal(
      tokenEstimateBlocks(content),
      tokenEstimate(textOfContent(content)),
      'fuzz #' + iter + ' ' + JSON.stringify(content),
    )
  }
})

// ---- cleanup-pass coverage: plan-like shape and the classifier hard branches --

test('isPlanLike: phrase, bullet list, and numbered steps all read as a plan', () => {
  assert.equal(isPlanLike('step by step please', 'Step by step please'), true)
  assert.equal(isPlanLike('步骤', '步骤'), true)
  const bullets = '- a\n- b\n- c\n- d'
  assert.equal(isPlanLike(bullets.toLowerCase(), bullets), true, 'bulletMinLines reached')
  assert.equal(isPlanLike('- a\n- b', '- a\n- b'), false, 'two bullets are not a plan')
  const numbered = '1) open\n2) edit\n3) close'
  assert.equal(isPlanLike(numbered.toLowerCase(), numbered), true)
  assert.equal(isPlanLike('plain prose', 'plain prose'), false)
})

test('classifyStep: a dense brief and a structured spec both reach hard', () => {
  // denseStrongBig (>= 10 strong cues) -> hard without any shape
  const dense = normalizePolicyConfig({})
  const denseText = '重构 架构 设计 规划 迁移 优化 性能 并发 并行 调试 诊断 排查'
  assert.equal(classifyStep({ text: denseText }, dense).stepClass, 'hard')
  // denseStrongThreshold (>= 5) + plan shape -> hard
  const spec = '1) 重构\n2) 迁移\n3) 优化\n4) 调试\n5) 部署'
  const structured = classifyStep({ text: spec }, dense)
  assert.equal(structured.stepClass, 'hard')
  assert.match(structured.reason.join(' '), /structured engineering spec|dense engineering brief/)
  // A classifier called WITHOUT precompiled matchers still works (direct callers).
  const lazy = classifyStep({ text: '重构缓存层' }, { scoring: POLICY_DEFAULTS.scoring, strong: ['重构'], normal: [], cheap: [], wish: [] })
  assert.equal(lazy.stepClass, 'engineering')
})
