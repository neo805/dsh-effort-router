/**
 * Regression tests for the 0.2.15 review hardening pass.
 *
 * These exercise the full `apply()` seam: adapter cleanup, the off-safety
 * postcondition, and the read-only route's view/single-flight contracts.
 */
import './test-profile.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as entry from '../lib/index.js'

function makeHost(options = {}) {
  const listeners = new Map()
  const effects = []
  const routes = []
  const logs = []
  const webServer = { register(route) { routes.push(route); return () => {} } }
  const projections = options.projections ?? {
    stateOf: () => undefined,
    cachedSnapshot: () => undefined,
    register: () => () => {},
  }
  const services = {
    webServer,
    sessionProjections: projections,
    llm: options.llm,
    settings: options.settings,
    sessions: options.sessions,
    sessionQuery: options.sessionQuery,
    profileContext: undefined,
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn: (m) => logs.push(m) }),
    get(name) {
      const value = services[name]
      if (value !== undefined) return value
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
    effect(run) {
      const dispose = run()
      if (typeof dispose === 'function') effects.push(dispose)
      return () => {}
    },
    inject(_names, fn) { fn({ webServer, sessionProjections: projections, effect: (run) => { const d = run(); if (typeof d === 'function') effects.push(d); return () => {} } }); return () => {} },
  }
  entry.apply(ctx, options.config ?? entry.Config({}))
  const dispose = () => {
    while (effects.length > 0) {
      const fn = effects.pop()
      try { fn() } catch (_ignored) { /* test teardown is best-effort */ }
    }
  }
  const onRequest = listeners.get('agent/request')
  const call = async (path, query = '') => {
    const route = routes.find((r) => r.path === path)
    assert.ok(route, 'route registered: ' + path)
    const res = {
      status: 0,
      body: '',
      writeHead(status) { this.status = status },
      end(text) { this.body = text },
    }
    await route.handler({ url: path + query }, res)
    assert.equal(res.status, 200)
    return JSON.parse(res.body)
  }
  return { listeners, logs, dispose, onRequest, call, projections }
}

/** A fake llm with one adapter whose resolved info is shared by identity. */
function fakeLlm(modelInfo) {
  const originalResolve = async () => modelInfo
  const adapter = { resolveModel: originalResolve }
  return {
    llm: {
      adapters: new Map([['fake', { adapter }]]),
      async resolveModelInfo() { return modelInfo },
    },
    adapter,
    originalResolve,
  }
}

const agentFor = (id, messages = []) => ({
  sessionId: id,
  session: { id, header: {}, deriveMessages: () => messages },
})

test('apply: disposing restores adapter.resolveModel and never mutates resolved info', async () => {
  const shared = { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }] } }
  const { llm, adapter, originalResolve } = fakeLlm(shared)
  const host = makeHost({ llm })
  assert.notEqual(adapter.resolveModel, originalResolve, 'startup wraps the adapter')

  const masked = await adapter.resolveModel('p', 'm')
  assert.deepEqual(masked.reasoning.efforts.map((e) => e.id), ['off', 'low', 'auto'])
  assert.deepEqual(shared.reasoning.efforts.map((e) => e.id), ['off', 'low'], 'the adapter cache is not mutated')

  host.dispose()
  assert.equal(adapter.resolveModel, originalResolve, 'teardown restores the exact original')
  const restored = await adapter.resolveModel('p', 'm')
  assert.equal(restored, shared)
  assert.deepEqual(restored.reasoning.efforts.map((e) => e.id), ['off', 'low'], 'Auto disappears with the plugin')
})

test('apply: default Auto on an off-only vocabulary never emits off', async () => {
  const { llm } = fakeLlm({ reasoning: { efforts: [{ id: 'off' }] } })
  const host = makeHost({ llm })
  const out = await host.onRequest({ agent: agentFor('off-only'), turn: 1, step: 1 }, async () => ({
    provider: 'p', model: 'off-only', reasoningEffort: 'auto',
  }))
  assert.equal(out.reasoningEffort, undefined, 'no safe level exists, so the field is stripped')
  assert.ok(host.logs.some((m) => m.includes('off-only') && m.includes('no non-off')), 'the downgrade is loud')
  host.dispose()
})

test('apply: poisoned history never pretends to pin off on a model without an off rung', async () => {
  const llm = {
    adapters: new Map(),
    async resolveModelInfo(_provider, model) {
      return {
        reasoning: {
          efforts: model === 'off-capable'
            ? [{ id: 'off' }, { id: 'low' }]
            : [{ id: 'low' }, { id: 'high' }],
        },
      }
    },
  }
  const host = makeHost({ llm })
  const messages = [{ role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] }]
  const agent = agentFor('poison-switch', messages)
  // First establish store provenance: a human-selected off step.
  const manual = await host.onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'p', model: 'off-capable', reasoningEffort: 'off',
  }))
  assert.equal(manual.reasoningEffort, 'off')

  const out = await host.onRequest({ agent, turn: 1, step: 2 }, async () => ({
    provider: 'p', model: 'difficult-route', reasoningEffort: 'auto',
  }))
  assert.equal(out.reasoningEffort, undefined, 'low is not a valid off pin: strip instead of lying')
  assert.ok(
    host.logs.some((m) => m.includes('difficult-route') && m.includes('cannot preserve off')),
    'the unsupported poison pin is reported',
  )
  host.dispose()
})

// ---- read-only route contracts -------------------------------------------------

const EVENT_LOG = [
  { type: 'request/header', data: { header: { config: { provider: 'gw', model: 'thinker', reasoningEffort: 'high' } } } },
  { type: 'tool/call', data: { callId: 'call_stored' } },
]

function routeHost(options = {}) {
  return makeHost(options)
}

test('route: view=badge skips anchor resolution, while view=anchors skips decisions', async () => {
  let reads = 0
  const host = routeHost({
    sessionQuery: {
      async readSession() { reads += 1; return { events: EVENT_LOG } },
    },
  })
  const badge = await host.call('/effort-router/state', '?view=badge&sessionId=s-history')
  assert.equal(reads, 0, 'Badge never pays a stored-log read')
  assert.equal(badge.anchors, null, 'no anchors are computed for the badge view')
  assert.equal(badge.anchorsError, null)
  assert.ok(Object.hasOwn(badge, 'last'), 'the badge payload keeps its decision fields')
  assert.equal(Object.hasOwn(badge, 'recent'), false, 'the badge does not download the decision ring')

  const anchors = await host.call('/effort-router/state', '?view=anchors&sessionId=s-history')
  assert.equal(reads, 1)
  assert.equal(anchors.anchorsResolved, 'stored')
  assert.equal(anchors.anchors.call_stored.effort, 'high')
  assert.equal(Object.hasOwn(anchors, 'last'), false, 'trajectory does not download decision history')
  assert.equal(Object.hasOwn(anchors, 'recent'), false)

  const config = await host.call('/effort-router/state', '?view=config')
  assert.equal(reads, 1, 'the one-shot chat flag fetches no log')
  assert.equal(config.anchors, null)
  assert.equal(Object.hasOwn(config, 'last'), false)
  host.dispose()
})

test('route: concurrent stored reads share one in-flight read', async () => {
  let reads = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const host = routeHost({
    sessionQuery: {
      async readSession() {
        reads += 1
        await gate
        return { events: EVENT_LOG }
      },
    },
  })
  const first = host.call('/effort-router/state', '?view=anchors&sessionId=s-burst')
  const second = host.call('/effort-router/state', '?view=anchors&sessionId=s-burst')
  await new Promise((resolve) => setImmediate(resolve))
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(reads, 1, 'the two pollers are coalesced')
  assert.deepEqual(a.anchors, b.anchors)
  host.dispose()
})

test('route: anchorsError belongs to the request, not to a shared last-error slot', async () => {
  const projections = {
    stateOf(session, key) {
      if (key === 'effortRouterAnchors') return { anchors: { call_live: { provider: 'live', model: 'm', effort: 'low' } } }
      return undefined
    },
    cachedSnapshot: () => undefined,
    register: () => () => {},
  }
  const host = routeHost({
    projections,
    sessions: { get: (id) => (id === 's-live' ? { id } : undefined), list: () => [] },
    sessionQuery: { async readSession() { throw new Error('stored read exploded') } },
  })
  const failed = await host.call('/effort-router/state', '?view=anchors&sessionId=s-broken')
  assert.match(failed.anchorsError, /stored read exploded/)
  const live = await host.call('/effort-router/state', '?view=anchors&sessionId=s-live')
  assert.equal(live.anchorsResolved, 'session')
  assert.equal(live.anchorsError, null, 'the previous session failure does not leak into a live success')
  host.dispose()
})

test('route: a hint can locate an idle session outside the 8-session merge cap', async () => {
  const sessions = Array.from({ length: 9 }, (_, i) => ({ id: i === 0 ? 's-old' : 's-pad-' + i }))
  const tables = Object.fromEntries(sessions.map((s, i) => [s.id, {
    ['call_' + (i === 0 ? 'old' : 'pad_' + i)]: { provider: 'p' + i, model: 'm', effort: 'high' },
  }]))
  const projections = {
    stateOf(session, key) {
      if (key !== 'effortRouterAnchors') return undefined
      return { anchors: tables[session.id] || {} }
    },
    cachedSnapshot(session, keys) {
      if (!Array.isArray(keys) || !keys.includes('effortRouterAnchors')) return undefined
      return { values: { effortRouterAnchors: { anchors: tables[session.id] || {} } } }
    },
    register: () => () => {},
  }
  const host = routeHost({
    projections,
    sessions: { get: () => undefined, list: () => sessions },
  })
  const body = await host.call('/effort-router/state', '?view=anchors&hint=call_old')
  assert.equal(body.anchorsResolved, 'hint', 'the owning table is found without full-projection scans')
  assert.equal(body.anchors.call_old.provider, 'p0')
  host.dispose()
})