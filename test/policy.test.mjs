/**
 * policy.js unit tests — cue pipeline (dictionary/shape/volume), wish floor,
 * loudest-bump escalation, frugal demote, clamps.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLICY_DEFAULTS,
  classifyStep,
  decideEffort,
  demoteClass,
  errorTextMatches,
  escalateClass,
  evidenceBumps,
  normalizePolicyConfig,
  stableStringify,
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

test('classifyStep: dense engineering brief with structure -> hard', () => {
  const text = '重构 架构 设计 迁移 优化 性能 并发 调试 诊断 实现 集成\n```js\nclass A {}\n```'
  const r = classifyStep({ text, toolCalls: 0 }, cfg)
  assert.equal(r.stepClass, 'hard')
})

test('classifyStep: bare tool loop is not engineering by default', () => {
  const r = classifyStep({ text: '看一下这个文件', toolCalls: 12 }, cfg)
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
  assert.equal(decideEffort(cfg, { text: '翻译这句话', toolCalls: 0 }).tier, 'low')
  assert.equal(decideEffort(cfg, { text: '重构缓存层', toolCalls: 0 }).tier, 'high')
})

test('decideEffort: hard routes to max by default; opt-out clamps to fallback', () => {
  const text = '重构 架构 设计 迁移 优化 性能 并发 调试 诊断 实现 集成\n```js\nclass A {}\n```'
  const d = decideEffort(cfg, { text, toolCalls: 0 })
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.tier, 'max') // allowMax defaults to true (0.2.0)
  const noMax = normalizePolicyConfig({ allowMax: false })
  const clamped = decideEffort(noMax, { text, toolCalls: 0 })
  assert.equal(clamped.tier, 'high')
  assert.ok(clamped.reason.join().includes('max is opt-out'))
})

test('decideEffort: escalation on evidence lifts the class, capped', () => {
  const signals = { text: '这个文件有问题', toolCalls: 4, escalations: 2 }
  const d = decideEffort(cfg, signals)
  // standard +2 -> hard (capped at hard), tier max (allowMax default)
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.tier, 'max')
})

test('decideEffort: carry lifts engineering one class', () => {
  const d = decideEffort(cfg, { text: '重构缓存层', toolCalls: 0, carry: 1, escalations: 0 })
  assert.equal(d.stepClass, 'hard')
})

test('decideEffort: volume cues lift on a log ladder, loudest wins, no stacking', () => {
  // brief >400 -> +1: standard -> engineering
  const brief1 = decideEffort(cfg, { text: '今天天气怎么样', toolCalls: 0, briefTokens: 500 })
  assert.equal(brief1.stepClass, 'engineering')
  assert.ok(brief1.reason.join().includes('brief volume'))
  // brief >1600 -> +2: standard -> hard
  const brief2 = decideEffort(cfg, { text: '今天天气怎么样', toolCalls: 0, briefTokens: 1700 })
  assert.equal(brief2.stepClass, 'hard')
  // tool window >48000 -> +1
  const tool1 = decideEffort(cfg, { text: '今天天气怎么样', toolCalls: 3, toolVolume: 50000 })
  assert.equal(tool1.stepClass, 'engineering')
  // evidence +1 AND brief volume +2 -> the louder +2 applies, never +3
  const loud = decideEffort(cfg, { text: '今天天气怎么样', toolCalls: 0, escalations: 1, briefTokens: 1700 })
  assert.equal(loud.stepClass, 'hard')
  // cheap intent is exempt from volume lifts
  const exempt = decideEffort(cfg, { text: '翻译这句话', toolCalls: 1, briefTokens: 5000, toolVolume: 200000 })
  assert.equal(exempt.stepClass, 'trivial')
})

test('evidenceBumps: error and repeat thresholds', () => {
  assert.equal(evidenceBumps(0, 0, cfg), 0)
  assert.equal(evidenceBumps(1, 0, cfg), 1) // 0.2.6 (audit R4.1): the FIRST error lifts one class
  assert.equal(evidenceBumps(2, 0, cfg), 2) // second rung: errors >= onErrors*2
  assert.equal(evidenceBumps(4, 0, cfg), 2) // capped by maxEscalations
  assert.equal(evidenceBumps(0, 3, cfg), 1)
  assert.equal(evidenceBumps(9, 9, normalizePolicyConfig({ maxEscalations: 1 })), 1)
})

test('decideEffort: frugal signal demotes one class', () => {
  const d = decideEffort(cfg, { text: '重构缓存层', toolCalls: 0, frugal: true, frugalWhy: 'subagent' })
  assert.equal(d.stepClass, 'standard')
  assert.equal(d.tier, 'low')
  assert.ok(d.reason.join().includes('frugal'))
  const off = normalizePolicyConfig({ frugalDemote: false })
  assert.equal(decideEffort(off, { text: '重构缓存层', toolCalls: 0, frugal: true }).tier, 'high')
})

test('decideEffort: poisoned history pins off', () => {
  const d = decideEffort(cfg, { text: '重构缓存层', toolCalls: 1, poisonedHistory: true })
  assert.equal(d.tier, 'off')
  assert.equal(d.poisoned, true)
})

test('decideEffort: a route of off can never be emitted (rule 4)', () => {
  const weird = normalizePolicyConfig({})
  weird.routes = { trivial: 'off', standard: 'off', engineering: 'off', hard: 'off' }
  const d = decideEffort(weird, { text: '翻译', toolCalls: 0 })
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
