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

test('apply: our own pending=auto stamp never locks the session manual (phantom-manual regression)', async () => {
  const logs = []
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  // DYNAMIC projection, mirroring the real host: model/selection sets
  // pending (applyModelSelectionProjection). The 0.2.x bug: our step-1
  // markAutoPending stamp made pending non-null, the old guard read that
  // as "a durable human pick", and step 2's mirrored 'low' seed recorded
  // manual — locking every later step the same way.
  const projection = { pending: null, lastUsed: null }
  const sessionProjections = {
    stateOf: (_session, key) => (key === 'modelSelection' ? projection : undefined),
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
  const appends = []
  const agent = {
    sessionId: 's-phantom',
    session: {
      id: 's-phantom',
      header: {},
      deriveMessages: () => [],
      append: (type, data) => {
        appends.push({ type, data })
        if (type === 'model/selection') projection.pending = data
      },
    },
  }
  onClaimed({ agent, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  const step1 = await onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step1.reasoningEffort, 'low')
  assert.equal(projection.pending?.reasoningEffort, 'auto', 'step 1 stamped pending=auto')
  // steps 2..4: the host mirrors the stamped header back as concrete seeds.
  for (const step of [2, 3, 4]) {
    const out = await onRequest({ agent, turn: 1, step }, async () => ({
      provider: 'gw', model: 'thinker', reasoningEffort: 'low',
    }))
    assert.equal(out.reasoningEffort, 'low')
  }
  assert.equal(
    logs.filter((m) => m.includes('class trivial')).length,
    4,
    'every mirrored step stayed in the scheduler (no phantom manual lock)',
  )
  assert.equal(appends.length, 1, 'the auto stamp is idempotent (one append total)')
})

test('apply: a UI Auto pick (pending=auto) keeps concrete seeds in the scheduler', async () => {
  const logs = []
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  // The user explicitly picked Auto: durable intent 'auto' from the start.
  // A concrete seed on the same route is the header mirror, not a pick.
  const sessionProjections = {
    stateOf: (_session, key) => (key === 'modelSelection'
      ? { pending: { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }, lastUsed: null }
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
    sessionId: 's-uiauto',
    session: { id: 's-uiauto', header: {}, deriveMessages: () => [], append: () => {} },
  }
  onClaimed({ agent, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  const out = await onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'high',
  }))
  assert.equal(out.reasoningEffort, 'low', 'the mirrored concrete seed is rescheduled')
  assert.ok(logs.some((m) => m.includes('class trivial')), 'the scheduler ran despite pending=auto')
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

test('route: sessionId direct, hint resolution, and ambiguity-safe merge', async () => {
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
  // Persisted-log fallback (0.2.12): a session opened from history in the Web
  // UI is not attached to the live store, so its anchors come from
  // sessionQuery.load(). Events carry the same shapes the projection folds.
  const STORED_EVENTS = [
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' } } } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [] } } },
  ]
  const sessionQuery = {
    load: async (id) => {
      if (id === 's-stored') return { events: STORED_EVENTS }
      throw new Error('session "' + id + '" not found')
    },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'sessions') return sessions
      if (name === 'sessionProjections') return sessionProjections
      if (name === 'sessionQuery') return sessionQuery
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

  // Bare merge: the colliding assistant key is AMBIGUOUS and must decorate
  // nothing; globally-unique tool call keys still survive.
  const merged = await call('')
  assert.equal(merged.anchorsResolved, 'merged')
  assert.equal(merged.anchors[KEY], undefined, 'ambiguity paints nothing, never the wrong session')
  assert.equal(merged.anchors.call_old.model, 'kimi-k3')
  assert.equal(merged.anchors.call_new.model, 'deepseek-flash')

  // A session opened from history (not attached to the live store) resolves
  // from its persisted log (0.2.12).
  const stored = await call('?sessionId=s-stored')
  assert.equal(stored.anchorsResolved, 'stored')
  assert.equal(stored.anchors[KEY].provider, 'deepseek-account', 'the stored log folds into the same anchor shape')
  assert.equal(stored.anchors[KEY].model, 'deepseek-flash')
  assert.equal(stored.anchors[KEY].effort, 'low')

  // A KNOWN session id this runtime cannot read at all must not fall through
  // to the merged table either (2026-10-18 Web report).
  const unknown = await call('?sessionId=session-00000000-0000-0000-0000-000000000000')
  assert.equal(unknown.anchors, null, 'unknown session: no merged substitute')
})

test('apply: poison pin needs shape AND store provenance, and applies immediately', async () => {
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

  // 1. Shape alone never pins: the engineering brief schedules high.
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

  // 3. Shape + provenance: pinned off IMMEDIATELY (0.2.8 has no hysteresis
  //    to bypass — the drift engine applies every decision as computed).
  const step3 = await onRequest({ agent, turn: 1, step: 3 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step3.reasoningEffort, 'off', 'proven poison pins off at once')

  // 4. Compaction removes the offending turn: the projection shrinks, the
  //    shape flag clears, and scheduling resumes.
  agent.session.deriveMessages = () => [{ role: 'user', content: '重构缓存层' }]
  const step4 = await onRequest({ agent, turn: 1, step: 4 }, async () => ({
    provider: 'gw', model: 'thinker', reasoningEffort: 'auto',
  }))
  assert.equal(step4.reasoningEffort, 'high', 'the pin lifts with compaction')
})
