/**
 * index.js smoke test — the entry module loads, the Config schema accepts its
 * defaults, and apply() wires an interceptor that schedules a synthetic
 * request end-to-end with mocked host services.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as entry from '../lib/index.js'

test('entry exports name/inject/Config/DEFAULT_CONFIG/apply', () => {
  assert.equal(entry.name, 'dsh-effort-router')
  assert.ok(Array.isArray(entry.inject))
  assert.equal(typeof entry.apply, 'function')
  assert.equal(entry.DEFAULT_CONFIG.defaultLevel, 'auto')
  // schema resolves defaults (volatile fields surface as live refs)
  const resolved = entry.Config({})
  assert.equal(entry.readVolatile(resolved.defaultLevel, 'auto'), 'auto')
  assert.equal(resolved.routes.engineering, 'high')
})

test('apply: schedules an auto request and passes a manual pick through', async () => {
  const listeners = new Map()
  const registered = []
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      throw new Error('no service ' + name)
    },
    on(event, handler) {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
    inject(_services, fn) {
      // webServer / sessionProjections are absent in this mock: never call fn
      return () => {}
    },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  assert.equal(typeof onRequest, 'function', 'agent/request interceptor registered')
  const onClaimed = listeners.get('agent/inbox/claimed')
  assert.equal(typeof onClaimed, 'function', 'inbox claim listener registered')

  const agent = {
    sessionId: 's1',
    session: { id: 's1', header: {}, deriveMessages: () => [] },
  }
  onClaimed({ agent, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })

  // auto: engineering brief -> high
  const autoSeed = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'auto' }
  const autoOut = await onRequest({ agent, turn: 1, step: 1 }, async () => autoSeed)
  assert.equal(autoOut.reasoningEffort, 'high')

  // manual: concrete level passes through untouched
  const manualSeed = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }
  const manualOut = await onRequest({ agent, turn: 1, step: 2 }, async () => manualSeed)
  assert.equal(manualOut.reasoningEffort, 'max')
})

test('apply: a model without reasoning metadata gets the field stripped', async () => {
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() { return {} }, // no reasoning
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  const agent = { sessionId: 's2', session: { id: 's2', header: {}, deriveMessages: () => [] } }
  const out = await onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'custom-gw', model: 'plain', reasoningEffort: 'auto',
  }))
  assert.equal(out.reasoningEffort, undefined)
})

test('apply: enabled=false passes everything through', async () => {
  const listeners = new Map()
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get() { throw new Error('no service') },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  const config = entry.Config({ enabled: false })
  entry.apply(ctx, config)
  const onRequest = listeners.get('agent/request')
  const seed = { provider: 'p', model: 'm', reasoningEffort: 'auto' }
  const out = await onRequest({ agent: { session: {} }, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed)
})
