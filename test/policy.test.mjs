/**
 * policy.js unit tests — classification, escalation, frugal demote, clamps.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  POLICY_DEFAULTS,
  classifyStep,
  decideEffort,
  demoteClass,
  escalateClass,
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

test('decideEffort: routes table drives the tier', () => {
  assert.equal(decideEffort(cfg, { text: '翻译这句话', toolCalls: 0 }).tier, 'low')
  assert.equal(decideEffort(cfg, { text: '重构缓存层', toolCalls: 0 }).tier, 'high')
})

test('decideEffort: hard clamps to maxFallback when allowMax is false', () => {
  const text = '重构 架构 设计 迁移 优化 性能 并发 调试 诊断 实现 集成\n```js\nclass A {}\n```'
  const d = decideEffort(cfg, { text, toolCalls: 0 })
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.tier, 'high')
  assert.ok(d.reason.join().includes('max is opt-in'))
  const withMax = normalizePolicyConfig({ allowMax: true })
  assert.equal(decideEffort(withMax, { text, toolCalls: 0 }).tier, 'max')
})

test('decideEffort: escalation on evidence lifts the class, capped', () => {
  const signals = { text: '帮我看看这个', toolCalls: 4, escalations: 2 }
  const d = decideEffort(cfg, signals)
  // standard +2 -> hard (capped at hard), tier high (max not allowed)
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.tier, 'high')
})

test('decideEffort: carry lifts engineering one class', () => {
  const d = decideEffort(cfg, { text: '重构缓存层', toolCalls: 0, carry: 1, escalations: 0 })
  assert.equal(d.stepClass, 'hard')
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

test('escalateClass/demoteClass ladder', () => {
  assert.equal(escalateClass('trivial', 1), 'standard')
  assert.equal(escalateClass('standard', 5), 'hard') // capped at ceiling
  assert.equal(demoteClass('hard'), 'engineering')
  assert.equal(demoteClass('trivial'), 'trivial')
})

test('scoreOf stays in [0,100]', () => {
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
