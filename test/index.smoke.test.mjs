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

test('DEFAULT_CONFIG stays in lockstep with the Config schema defaults', () => {
  // The schema is the single source of truth at runtime; DEFAULT_CONFIG is
  // the plain-object mirror read by liveSnapshot fallbacks. Drift between the
  // two used to be guarded by hand — pin every key mechanically instead.
  const resolved = entry.Config({})
  const read = (value, fallback) => entry.readVolatile(value, fallback)
  for (const [key, expected] of Object.entries(entry.DEFAULT_CONFIG)) {
    assert.ok(key in resolved, 'schema is missing DEFAULT_CONFIG key: ' + key)
    const actual = read(resolved[key], expected)
    assert.deepEqual(actual, expected, 'default drift on ' + key)
  }
  for (const key of Object.keys(resolved)) {
    assert.ok(key in entry.DEFAULT_CONFIG, 'DEFAULT_CONFIG is missing schema key: ' + key)
  }
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

test('apply: enabled=false passes through, but strips our own auto mask', async () => {
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
  // 'auto' is OUR advertisement, unknown to the model: stripped even when off
  const autoOut = await onRequest({ agent: { session: {} }, turn: 1, step: 1 }, async () => ({
    provider: 'p', model: 'm', reasoningEffort: 'auto',
  }))
  assert.equal(autoOut.reasoningEffort, undefined)
  // a concrete manual level is not ours to touch: passes through by reference
  const manualSeed = { provider: 'p', model: 'm', reasoningEffort: 'max' }
  const manualOut = await onRequest({ agent: { session: {} }, turn: 1, step: 2 }, async () => manualSeed)
  assert.equal(manualOut, manualSeed)
})

test('apply: a selection echo is proven by OUR decision store and rescheduled', async () => {
  const logs = []
  const appends = []
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  // No durable pick (pending null); the projection mock stays static so the
  // echo window persists — the append spy proves the write-back fired.
  const sessionProjections = {
    stateOf: (_session, key) => (key === 'modelSelection'
      ? { pending: null, lastUsed: { provider: 'gw', model: 'thinker', reasoningEffort: 'low' } }
      : undefined),
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'sessionProjections') return sessionProjections
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  const onClaimed = listeners.get('agent/inbox/claimed')
  const agent = {
    sessionId: 's-echo',
    session: {
      id: 's-echo',
      header: {},
      deriveMessages: () => [],
      append: (type, data) => appends.push({ type, data }),
    },
  }
  onClaimed({ agent, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  // step 1: seed 'auto' -> scheduled (records mode 'auto', effort 'low')
  const step1 = await onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step1.reasoningEffort, 'low')
  // the write-back stamped pending='auto' for the host's selection state
  assert.deepEqual(appends, [{
    type: 'model/selection',
    data: { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' },
  }])
  // step 2: the concrete echo comes back — the store proves it was OURS
  const step2 = await onRequest({ agent, turn: 1, step: 2 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'low',
  }))
  assert.equal(step2.reasoningEffort, 'low')
  assert.equal(
    logs.filter((m) => m.includes('class trivial')).length,
    2,
    'both steps went through the scheduler (the echo was not honored as manual)',
  )
})

test('apply: a consumed explicit pick stays manual (store witness says mode manual)', async () => {
  const logs = []
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  // The user picked 'high'; the host consumed the pending pick after the
  // matching header, so pending is null again and only lastUsed remains —
  // indistinguishable from an echo UNLESS the store proves the last decision
  // was mode 'manual'.
  const sessionProjections = {
    stateOf: (_session, key) => (key === 'modelSelection'
      ? { pending: null, lastUsed: { provider: 'gw', model: 'thinker', reasoningEffort: 'high' } }
      : undefined),
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'sessionProjections') return sessionProjections
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  const agent = { sessionId: 's-picked', session: { id: 's-picked', header: {}, deriveMessages: () => [] } }
  const seed1 = { provider: 'gw', model: 'thinker', reasoningEffort: 'high' }
  const out1 = await onRequest({ agent, turn: 1, step: 1 }, async () => seed1)
  assert.equal(out1, seed1)
  const seed2 = { provider: 'gw', model: 'thinker', reasoningEffort: 'high' }
  const out2 = await onRequest({ agent, turn: 1, step: 2 }, async () => seed2)
  assert.equal(out2, seed2)
  assert.ok(!logs.some((m) => m.includes('class ')), 'a consumed manual pick is never rescheduled')
})

test('apply: a durable pending pick keeps the concrete level manual', async () => {
  const logs = []
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  const sessionProjections = {
    stateOf: (_session, key) => (key === 'modelSelection'
      ? { pending: { provider: 'gw', model: 'thinker', reasoningEffort: 'low' }, lastUsed: null }
      : undefined),
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'sessionProjections') return sessionProjections
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  const agent = { sessionId: 's-pick', session: { id: 's-pick', header: {}, deriveMessages: () => [] } }
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'low' }
  const out = await onRequest({ agent, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'explicit pick passes through verbatim')
  assert.ok(!logs.some((m) => m.includes('class ')), 'no scheduling happened for a durable pick')
})

test('route: sessionId direct, hint resolution, and newest-wins merged order', async () => {
  const routes = []
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  const KIMI = { provider: 'moonshotai-cn', model: 'kimi-k3', effort: 'low' }
  const FLASH = { provider: 'deepseek-account', model: 'deepseek-flash', effort: 'max' }
  const KEY = ['assistant', '1', '1'].join('\0')
  const perSession = {
    's-old': { [KEY]: KIMI, call_old: KIMI },
    's-new': { [KEY]: FLASH, call_new: FLASH },
  }
  // list() comes back oldest → newest, matching the live sessions store.
  const sessions = {
    list: () => [{ id: 's-old' }, { id: 's-new' }],
    get: (id) => (perSession[id] ? { id } : undefined),
  }
  const sessionProjections = {
    stateOf: (session) => ({ anchors: perSession[session.id] }),
    register: () => () => {},
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'sessions') return sessions
      if (name === 'sessionProjections') return sessionProjections
      throw new Error('no service ' + name)
    },
    on() { return () => {} },
    inject(_services, fn) {
      const scope = {
        webServer,
        sessionProjections,
        effect: (run) => { try { run() } catch (_ignored) { /* other injects */ } return () => {} },
      }
      try { fn(scope) } catch (_ignored) { /* this mock only serves webServer */ }
      return () => {}
    },
  }
  entry.apply(ctx, entry.Config({}))
  const route = routes.find((r) => r.path === '/effort-router/state')
  assert.ok(route, 'state route registered')

  const call = async (query) => {
    const res = {
      status: 0,
      body: '',
      writeHead(status) { this.status = status },
      end(text) { this.body = text },
    }
    await route.handler({ url: '/effort-router/state' + query }, res)
    assert.equal(res.status, 200)
    return JSON.parse(res.body)
  }

  // Direct: the sessionId table comes back untouched.
  const direct = await call('?sessionId=s-old')
  assert.equal(direct.anchorsResolved, 'session')
  assert.equal(direct.anchors[KEY].model, 'kimi-k3')

  // Hint: one visible tool call id identifies the on-screen session despite
  // the colliding assistant key — the 0.2.6 wrong-attribution bug.
  const hinted = await call('?hint=call_old')
  assert.equal(hinted.anchorsResolved, 'hint')
  assert.equal(hinted.anchors[KEY].model, 'kimi-k3')

  // Bare merge: the newest session wins colliding assistant keys, unique
  // tool call keys from every session survive.
  const merged = await call('')
  assert.equal(merged.anchorsResolved, 'merged')
  assert.equal(merged.anchors[KEY].model, 'deepseek-flash')
  assert.equal(merged.anchors.call_old.model, 'kimi-k3')
})

test('apply: poison pin needs shape AND store provenance, and bypasses hysteresis', async () => {
  const listeners = new Map()
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
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  const onClaimed = listeners.get('agent/inbox/claimed')

  // History carries the SHAPE SUSPECT from the start: a reasoning-less tool
  // call — exactly what a thinking-on kimi-K3 tool step looks like.
  const suspectTurn = { role: 'assistant', content: [{ type: 'tool-call', name: 'calculator', arguments: '{}' }] }
  const agent = {
    sessionId: 's-poison',
    session: {
      id: 's-poison',
      header: {},
      deriveMessages: () => [{ role: 'user', content: '重构缓存层' }, suspectTurn],
    },
  }
  onClaimed({ agent, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })

  // 1. Shape alone never pins: the engineering brief schedules high (and sets
  //    the hysteresis memory to high).
  const step1 = await onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step1.reasoningEffort, 'high', 'no store proof: shape alone must not pin off')

  // 2. The user explicitly picks off: passes through and records a PROVEN
  //    manual-off step in the decision store.
  const step2 = await onRequest({ agent, turn: 1, step: 2 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'off',
  }))
  assert.equal(step2.reasoningEffort, 'off')

  // 3. Shape + provenance: pinned off IMMEDIATELY — hysteresis would have held
  //    'high' for downAfter quiet decisions, so 'off' here also proves the pin
  //    bypasses hysteresis.
  const step3 = await onRequest({ agent, turn: 1, step: 3 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step3.reasoningEffort, 'off', 'proven poison pins off at once')

  // 4. Compaction removes the offending turn: the projection shrinks, the
  //    shape flag clears, and scheduling resumes (hysteresis memory was not
  //    touched by the pin, so high comes straight back).
  agent.session.deriveMessages = () => [{ role: 'user', content: '重构缓存层' }]
  const step4 = await onRequest({ agent, turn: 1, step: 4 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step4.reasoningEffort, 'high', 'the pin lifts with compaction')
})
