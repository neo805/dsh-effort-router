/**
 * policy.js unit tests — cue pipeline (dictionary/shape/volume), wish floor,
 * loudest-bump escalation, frugal demote, clamps. Score is telemetry only.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLICY_DEFAULTS,
  classifyStep,
  decideEffort,
  demoteClass,
  escalateClass,
  evidenceBumps,
  normalizePolicyConfig,
  scoreOf,
  toolErrorsOf,
  toolCallWithoutReasoning,
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
  assert.equal(evidenceBumps(2, 0, cfg), 1)
  assert.equal(evidenceBumps(4, 0, cfg), 2)
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

test('scoreOf stays in [0,100] and never enters decisions', () => {
  const { score } = scoreOf({ text: 'x'.repeat(5000), toolCalls: 99 }, cfg)
  assert.ok(score >= 0 && score <= 100)
})

test('toolCallWithoutReasoning / toolErrorsOf', () => {
  const poisoned = [{ type: 'tool-call', name: 'read', arguments: '{}' }]
  assert.equal(toolCallWithoutReasoning(poisoned), true)
  assert.equal(toolCallWithoutReasoning([{ type: 'reasoning' }, ...poisoned]), false)
  const results = [{ type: 'tool-result', isError: true, content: 'x' }, { type: 'tool-result', content: 'ok' }]
  assert.equal(toolErrorsOf(results), 1)
})
