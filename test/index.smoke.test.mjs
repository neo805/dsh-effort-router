/**
 * index.js smoke test — the entry module loads, the Config schema accepts its
 * defaults, and apply() wires an interceptor that schedules a synthetic
 * request end-to-end with mocked host services.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as entry from '../lib/index.js'
import { POLICY_DEFAULTS } from '../lib/policy.js'

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
  // Persisted-log fallback (0.2.12+): a session opened from history in the Web
  // UI is not attached to the live store, so its anchors come from
  // sessionQuery.readSession() (the public read API; it does NOT make the
  // session live and takes no write lease). Events carry the same shapes the
  // projection folds.
  const STORED_EVENTS = [
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' } } } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [] } } },
  ]
  const sessionQuery = {
    readSession: async (id) => {
      if (id === 's-stored') return { session: { id }, inheritedEventCount: 0, events: STORED_EVENTS }
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

// ---- cleanup-pass coverage: interceptor branches that had no test ------------

/** Minimal host ctx for one interceptor test. */
function interceptorCtx(options = {}) {
  const listeners = new Map()
  const logs = []
  const llm = options.llm ?? {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn: (m) => logs.push(m) }),
    get(name) {
      if (name === 'llm') return llm
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, options.config ?? entry.Config({}))
  return { onRequest: listeners.get('agent/request'), logs }
}

const plainAgent = (id = 's1', header = {}) => ({
  sessionId: id,
  session: { id, header, deriveMessages: () => [] },
})

test('apply: a pinned defaultLevel fills an unselected request instead of scheduling', async () => {
  const { onRequest, logs } = interceptorCtx({ config: entry.Config({ defaultLevel: 'high' }) })
  const out = await onRequest({ agent: plainAgent('s-def'), turn: 1, step: 1 }, async () => ({
    provider: 'gw', model: 'thinker',
  }))
  assert.equal(out.reasoningEffort, 'high', 'the pinned level is mapped onto the model vocabulary')
  assert.ok(!logs.some((m) => m.includes('class ')), 'no scheduling happened for a pinned default')
})

test('apply: subagentEffort fills a subagent request that carries no level', async () => {
  const { onRequest } = interceptorCtx({ config: entry.Config({ subagentEffort: 'high' }) })
  const agent = plainAgent('s-sub', { delegationDepth: 1 })
  const out = await onRequest({ agent, turn: 1, step: 1 }, async () => ({ provider: 'gw', model: 'thinker' }))
  assert.equal(out.reasoningEffort, 'high')
  // An explicit parent level still wins: the subagent default only fills blanks.
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'low' }
  const manual = await onRequest({ agent, turn: 1, step: 2 }, async () => seed)
  assert.equal(manual, seed)
})

test('apply: a level the model does not advertise is stripped, never clamped', async () => {
  const { onRequest } = interceptorCtx()
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'xhigh' }
  const out = await onRequest({ agent: plainAgent('s-strip'), turn: 1, step: 1 }, async () => seed)
  assert.notEqual(out, seed, 'a copy is returned, the seed is left alone')
  assert.equal(out.reasoningEffort, undefined, 'an unadvertised explicit pick is dropped, not approximated')
})

test('apply: the interceptor fails OPEN — a broken config still passes the request through', async () => {
  // A config whose volatile read throws: the interceptor's outer try/catch must
  // return the seed untouched (README: degradation is "no opinion", never a
  // broken request).
  const hostile = Object.defineProperty({}, 'enabled', {
    get() { throw new Error('boom') },
  })
  const { onRequest, logs } = interceptorCtx({ config: hostile })
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }
  const out = await onRequest({ agent: plainAgent('s-boom'), turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'the request is returned by reference')
  assert.ok(
    logs.some((m) => m.includes('interceptor failed; passing the request through')),
    'the failure is reported, not swallowed silently',
  )
})

// ---- cleanup-pass coverage: the read-only routes -----------------------------

/** Minimal host ctx exposing the web routes for direct handler calls. */
function routeHarness(config, services = {}) {
  const routes = []
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  const projections = services.projections ?? {
    stateOf: () => undefined,
    register: () => () => {},
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'sessionProjections') return projections
      if (name === 'sessions') return services.sessions
      if (name === 'sessionQuery') return services.sessionQuery
      throw new Error('no service ' + name)
    },
    on() { return () => {} },
    inject(_names, fn) {
      fn({ webServer, sessionProjections: projections, effect: (run) => { run(); return () => {} } })
      return () => {}
    },
  }
  entry.apply(ctx, config)
  const asJson = async (path, query = '') => {
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
  return { routes, asJson }
}

test('route: /effort-router/dictionaries reports effective, builtin, override, additions', async () => {
  const plain = routeHarness(entry.Config({}))
  const builtin = await plain.asJson('/effort-router/dictionaries')
  assert.equal(builtin.ok, true)
  assert.deepEqual(builtin.dictionaries.strong.effective, POLICY_DEFAULTS.strong)
  assert.equal(builtin.dictionaries.strong.override, null)
  assert.deepEqual(builtin.dictionaries.strong.additions, [])
  assert.deepEqual(builtin.dictionaries.strong.builtin, POLICY_DEFAULTS.strong)

  // Additive cues merge ON TOP of the shipped list.
  const edited = routeHarness(entry.Config({ cuesStrong: 'zed, 繁体字' }))
  const added = await edited.asJson('/effort-router/dictionaries')
  assert.deepEqual(added.dictionaries.strong.additions, ['zed', '繁体字'])
  assert.deepEqual(added.dictionaries.strong.effective, [...POLICY_DEFAULTS.strong, 'zed', '繁体字'])
  assert.equal(added.dictionaries.strong.override, null)

  // dict* REPLACES the list whole (deletions included).
  const replaced = routeHarness(entry.Config({ dictStrong: 'only-this' }))
  const full = await replaced.asJson('/effort-router/dictionaries')
  assert.deepEqual(full.dictionaries.strong.override, ['only-this'])
  assert.deepEqual(full.dictionaries.strong.effective, ['only-this'])
})

test('route: a history session reads through observeSession when readSession is absent', async () => {
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'gw', model: 'thinker', reasoningEffort: 'high' } } } },
    { type: 'tool/call', data: { callId: 'call_x' } },
  ]
  let disposed = 0
  const harness = routeHarness(entry.Config({}), {
    sessionQuery: {
      // This host exposes the lease-based observation only (0.2.1 shape when
      // readSession is missing): the route must still serve the stored table.
      async observeSession(id) {
        if (id !== 's-history') throw new Error('session "' + id + '" not found')
        return {
          events,
          [Symbol.dispose]() { disposed += 1 },
          close() { disposed += 1 },
        }
      },
    },
  })
  const body = await harness.asJson('/effort-router/state', '?sessionId=s-history')
  assert.equal(body.anchorsResolved, 'stored')
  assert.equal(body.anchors.call_x.effort, 'high', 'the fold runs over the observed events')
  assert.equal(disposed, 1, 'the observation is released after the fold')
  assert.equal(body.anchorsError, null, 'a successful read clears the diagnosis field')
})

// ---- cleanup-pass coverage: the stored-read diagnosis paths ------------------

const storedEvents = [
  { type: 'request/header', data: { header: { config: { provider: 'gw', model: 'thinker', reasoningEffort: 'low' } } } },
  { type: 'tool/call', data: { callId: 'call_cached' } },
]

test('route: an unreadable history session reports WHY instead of painting nothing', async () => {
  // Neither public read API present.
  const blind = routeHarness(entry.Config({}), { sessionQuery: {} })
  const noApi = await blind.asJson('/effort-router/state', '?sessionId=s-noread')
  assert.equal(noApi.anchors, null)
  assert.match(noApi.anchorsError, /neither readSession nor observeSession/)

  // The API answered, but the log carries no events.
  const empty = routeHarness(entry.Config({}), {
    sessionQuery: { readSession: async () => ({ events: [] }) },
  })
  const noEvents = await empty.asJson('/effort-router/state', '?sessionId=s-empty')
  assert.equal(noEvents.anchors, null)
  assert.match(noEvents.anchorsError, /returned no events/)
})

test('route: the stored anchor table is cached per session across polls', async () => {
  let reads = 0
  const harness = routeHarness(entry.Config({}), {
    sessionQuery: {
      async readSession() {
        reads += 1
        return { events: storedEvents }
      },
    },
  })
  const first = await harness.asJson('/effort-router/state', '?sessionId=s-cached')
  assert.equal(first.anchorsResolved, 'stored')
  assert.equal(first.anchors.call_cached.provider, 'gw')
  assert.equal(reads, 1)
  // The client polls every 2.5 s; a finished log must cost one read, not one
  // read per poll (an LRU hit also refreshes the entry's position).
  const second = await harness.asJson('/effort-router/state', '?sessionId=s-cached')
  assert.equal(second.anchorsResolved, 'stored')
  assert.deepEqual(second.anchors, first.anchors)
  assert.equal(reads, 1, 'the second poll is served from the cache')
})

test('apply: an unreadable selection projection is never read as "no pick" (safe direction)', async () => {
  const logs = []
  const listeners = new Map()
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'sessionProjections') return { stateOf() { throw new Error('projection unavailable') } }
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, entry.Config({}))
  const onRequest = listeners.get('agent/request')
  const agent = plainAgent('s-unreadable')
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'max' }
  const out = await onRequest({ agent, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'an unknowable selection is left alone, never rescheduled over')
  assert.ok(!logs.some((m) => m.includes('class ')), 'no scheduling happened on an unreadable projection')
})

test('route: a throwing anchors projection degrades to the stored fallback, never a 500', async () => {
  const harness = routeHarness(entry.Config({}), {
    projections: {
      stateOf(_session, key) { if (key === 'effortRouterAnchors') throw new Error('poisoned state'); return undefined },
      register: () => () => {},
    },
    sessions: { get: (id) => ({ id }), list: () => [] },
  })
  const body = await harness.asJson('/effort-router/state', '?sessionId=s-throw')
  assert.equal(body.ok, true, 'the route still answers')
  assert.equal(body.anchors, null)
  assert.match(String(body.anchorsError), /sessionQuery service unavailable/)
})

// ---- R5: subagent routing (parent auto -> auto, parent manual -> manual) -----
//
// Host contract (dsh-subagent/lib/types/child-agent.js, verified 0.2.1-rc.2):
// `parentAgentOptionsForDelegation` gives the child the parent's LATEST REQUEST
// HEADER — provider, model and reasoningEffort — and `childSessionMeta` persists
// `parentSession`, `origin: "subagent"` and `delegationDepth` on the child
// header. So an inherited concrete effort is provoledge: it is either the level
// a human pinned in the parent, or the level WE scheduled there.

/** Fake host ctx for R5 tests; returns the listeners plus the decision trace. */
function r5Ctx(config = entry.Config({})) {
  const listeners = new Map()
  const logs = []
  const llm = {
    adapters: new Map(),
    async resolveModelInfo() {
      return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } }
    },
  }
  // A readable `modelSelection` with no pending pick is what a subagent session
  // actually has: markAutoPending skips delegation children, so their own
  // scheduled headers come back as plain echoes for the store to prove.
  const projections = { stateOf: (_session, key) => (key === 'modelSelection' ? { pending: null } : undefined) }
  const ctx = {
    logger: () => ({ info: (m) => logs.push(m), warn: (m) => logs.push(m) }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'sessionProjections') return projections
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  entry.apply(ctx, config)
  return { onRequest: listeners.get('agent/request'), onClaimed: listeners.get('agent/inbox/claimed'), logs }
}

const parentAgent = (id = 's-parent') => ({
  sessionId: id,
  session: { id, header: {}, deriveMessages: () => [] },
})

const childAgent = (parentId = 's-parent', id = 's-child') => ({
  sessionId: id,
  session: {
    id,
    header: { delegationDepth: 1, parentSession: parentId, origin: 'subagent', isSeeded: false },
    deriveMessages: () => [],
  },
})

/** Run one request through the interceptor. */
async function request(onRequest, agent, seed, turn = 1, step = 1) {
  return onRequest({ agent, turn, step }, async () => ({ ...seed }))
}

test('R5: a subagent inherits an AUTO parent as auto, not as a manual pick', async () => {
  const { onRequest, onClaimed, logs } = r5Ctx(entry.Config({ frugalDemote: false }))
  const parent = parentAgent()
  onClaimed({ agent: parent, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  const parentOut = await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  assert.equal(parentOut.reasoningEffort, 'low', 'the parent step was scheduled to low')

  // The child starts with the parent's stamped level as its seed (host contract)
  // but must be SCHEDULED from its own spawn brief.
  const child = childAgent()
  onClaimed({ agent: child, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  const childOut = await request(onRequest, child, { provider: 'gw', model: 'thinker', reasoningEffort: 'low' })
  assert.equal(childOut.reasoningEffort, 'high', 'the spawn brief (engineering) schedules high')
  assert.ok(
    logs.some((m) => m.includes('s-child') && m.includes('class engineering')),
    'the child ran through the scheduler',
  )
})

test('R5: the subagent frugal demotion applies once the warm-up floor expires', async () => {
  const { onRequest, onClaimed, logs } = r5Ctx()
  const parent = parentAgent('s-parent-f')
  onClaimed({ agent: parent, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })

  const child = childAgent('s-parent-f', 's-child-f')
  onClaimed({ agent: child, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  // The origin floor holds engineering for warmUpSteps (3) steps, so the
  // demotion is computed but does not move the level yet; it takes over on the
  // first step past the floor. Every seed is the child's OWN previous schedule.
  let effort = 'low'
  const seen = []
  for (let step = 1; step <= 5; step += 1) {
    const out = await onRequest({ agent: child, turn: 1, step }, async () => ({
      provider: 'gw', model: 'thinker', reasoningEffort: effort,
    }))
    effort = out.reasoningEffort
    seen.push(effort)
  }
  assert.deepEqual(seen, ['high', 'high', 'high', 'low', 'low'], 'warm-up floor first, demotion after it')
  assert.ok(logs.some((m) => m.includes('s-child-f') && m.includes('frugal: subagent')), 'demotion is logged')
})

test('R5: a MANUAL parent level is inherited verbatim, never rescheduled', async () => {
  const { onRequest, onClaimed, logs } = r5Ctx()
  const parent = parentAgent('s-parent-m')
  const pick = await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'max' })
  assert.equal(pick.reasoningEffort, 'max', 'the human pick passes through')

  const child = childAgent('s-parent-m', 's-child-m')
  onClaimed({ agent: child, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'max' }
  const out = await onRequest({ agent: child, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'inherited manual stays manual (same object, untouched)')
  assert.ok(!logs.some((m) => m.includes('s-child-m') && m.includes('class ')), 'no scheduling for the child')
})

test('R5: an unknown parent keeps the inherited level (conservative)', async () => {
  const { onRequest } = r5Ctx()
  const child = childAgent('s-parent-gone', 's-child-orphan')
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'low' }
  const out = await onRequest({ agent: child, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'without provenance the inherited level is left alone')
})

test('R5: an inherited off is never re-enabled on a poisoned lineage', async () => {
  const { onRequest, onClaimed } = r5Ctx()
  const parent = parentAgent('s-parent-p')
  // Prove a manual-off step in the parent, then the poison pin fires there.
  const suspect = { role: 'assistant', content: [{ type: 'tool-call', name: 'calculator', arguments: '{}' }] }
  parent.session.deriveMessages = () => [{ role: 'user', content: '重构缓存层' }, suspect]
  onClaimed({ agent: parent, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'off' })
  const pinned = await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }, 1, 2)
  assert.equal(pinned.reasoningEffort, 'off', 'the parent is pinned off')

  const child = childAgent('s-parent-p', 's-child-p')
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'off' }
  const out = await onRequest({ agent: child, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'off is a lineage safety pin: it is never overridden')
})

test('R5: a child whose seed does not match the parent decision is passed through', async () => {
  const { onRequest, onClaimed } = r5Ctx()
  const parent = parentAgent('s-parent-x')
  await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'max' })
  const child = childAgent('s-parent-x', 's-child-x')
  // The seed claims a level the parent never scheduled (e.g. the user changed
  // the model between the decision and the spawn): not OUR inheritance.
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'low' }
  const out = await onRequest({ agent: child, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed)
})

test('R5: non-blocking delegation — the parent advances past the spawn step and still routes the child', async () => {
  // 0.2.1 delegation returns immediately, so the parent stamps its NEXT step (with
  // a possibly different level) before the child's first request lands. Measured
  // live: parent auto/high -> auto/max, child seed high, child recorded manual.
  // The rule must accept any recent SCHEDULED level on the same route, not only
  // the newest decision.
  const { onRequest, onClaimed, logs } = r5Ctx(entry.Config({ frugalDemote: false }))
  const parent = parentAgent('s-parent-nb')
  onClaimed({ agent: parent, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  const step1 = await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  assert.equal(step1.reasoningEffort, 'high', 'parent step 1: engineering -> high')
  // A tool error lifts the parent's next step to hard/max, so its newest decision
  // no longer carries the level the child inherited.
  parent.session.deriveMessages = () => [
    { role: 'user', content: [{ type: 'text', text: '帮我重构这个模块的缓存层' }] },
    { role: 'tool', isError: true, content: [{ type: 'text', text: '[exit code: 1]' }] },
  ]
  const step2 = await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'high' }, 1, 2)
  assert.equal(step2.reasoningEffort, 'max', 'parent step 2: evidence lift -> max')

  const child = childAgent('s-parent-nb', 's-child-nb')
  onClaimed({ agent: child, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  const out = await request(onRequest, child, { provider: 'gw', model: 'thinker', reasoningEffort: 'high' })
  assert.equal(out.reasoningEffort, 'high', 'the one-step-behind seed is still OUR schedule')
  assert.ok(logs.some((m) => m.includes('s-child-nb') && m.includes('subagent inherited')), 'logged as inheritance')
})

test('R5: a parent that has moved to a MANUAL pick stops routing its children', async () => {
  const { onRequest, onClaimed } = r5Ctx()
  const parent = parentAgent('s-parent-m2')
  onClaimed({ agent: parent, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' })
  // The human now picks max by hand — a level we did NOT schedule, so the echo
  // guard cannot explain it away and the newest decision becomes manual.
  const pick = await request(onRequest, parent, { provider: 'gw', model: 'thinker', reasoningEffort: 'max' }, 1, 2)
  assert.equal(pick.reasoningEffort, 'max')

  const child = childAgent('s-parent-m2', 's-child-m2')
  const seed = { provider: 'gw', model: 'thinker', reasoningEffort: 'max' }
  const out = await onRequest({ agent: child, turn: 1, step: 1 }, async () => seed)
  assert.equal(out, seed, 'the parent is manual now: the child inherits verbatim')
})
