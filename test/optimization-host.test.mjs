/**
 * Host-contract and robustness tests for the 0.2.17 review.
 *
 * The continuous-turn fixture deliberately has NO await between step/end and
 * the next selection capture. That is the real 0.2.2 tool-continuation edge;
 * separate awaited runStep() calls would let queueMicrotask hide the bug.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ENGINEERING,
  TRIVIAL,
  assistantToolCall,
  createModernHost,
  loadApplyForRuntime,
  loadRuntimeWithAppBoot,
  toolResult,
  userMessage,
} from './helpers/host-0.2.2-harness.mjs'
import { advertiseAutoMask } from '../lib/capability.js'
import { fillCandidates, planFill } from '../lib/custom-models.js'
import { createStore } from '../lib/store.js'

const modernEntry = await loadApplyForRuntime('0.2.2-rc.3')
const LEVELS = { reasoning: { default: 'low', efforts: ['low', 'medium', 'high', 'max'].map((id) => ({ id })) } }
const entry = (effort = 'low', step = 1) => ({ at: 1, turn: 1, step, mode: 'auto', effort })
const settle = () => new Promise((resolve) => setImmediate(resolve))
const tempDirs = new Set()
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.add(dir)
  return dir
}

function modernHost(options = {}) {
  const dir = tempDir('er-optimization-profile-')
  const services = options.services || new Map()
  if (!services.has('profileContext')) services.set('profileContext', { name: 'optimization', dir })
  const host = createModernHost({
    apply: modernEntry.apply,
    config: modernEntry.Config({}),
    ...options,
    services,
  })
  return { host, file: join(dir, '.effort-router', 'state.json') }
}

test('D FR-040/060: current() resolves each strict continuation synchronously and records the actual effort', async (t) => {
  const { host, file } = modernHost({ strictAppend: true })
  t.after(() => host.dispose())
  await host.primeCapability()
  const nativeAuto = { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }
  const { agent } = host.createAgent('d-current-continuation', { effort: 'auto', pending: nativeAuto })
  const nativeSelect = agent.model.select
  let selectCalls = 0
  agent.model.select = function countedSelect(next) {
    selectCalls += 1
    return nativeSelect.call(this, next)
  }
  await host.announceAgent(agent)
  await host.runContinuousTurn(agent, {
    claimed: [userMessage(TRIVIAL)],
    steps: [
      { assistant: assistantToolCall(), toolResults: [toolResult('[exit code: 1] read failed', true)] },
      { claimed: [] },
    ],
  })
  assert.deepEqual(host.requests.map((request) => request.reasoningEffort), ['low', 'medium'])
  assert.equal(selectCalls, 0, 'D must not preselect concrete levels through model.select/append on step/end')
  assert.equal(host.selectionEvents.some((row) => row.reasoningEffort !== 'auto'), false, 'no concrete request value may enter native selection state')
  assert.equal(agent.model.current().reasoningEffort, 'auto', 'turn/end closes the concrete capture window')
  assert.equal(host.rawCurrent(agent).reasoningEffort, 'auto', 'raw native intent survives concrete request/header projection')
  assert.equal(agent.session.projection('modelSelection').pending.reasoningEffort, 'auto')
  host.dispose()
  const recent = JSON.parse(readFileSync(file, 'utf8')).sessions[agent.id]?.recent || []
  for (const [step, effort] of [[1, 'low'], [2, 'medium']]) {
    assert.ok(recent.some((row) => row.turn === 1 && row.step === step && row.mode === 'auto' && row.effort === effort))
  }
})

test('D T-01: repeated current() in one capture reuses one concrete decision', async (t) => {
  const { host, file } = modernHost({ strictAppend: true })
  t.after(() => host.dispose())
  await host.primeCapability()
  const nativeAuto = { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }
  const { agent } = host.createAgent('d-repeated-current', { effort: 'auto', pending: nativeAuto })
  const nativeSelect = agent.model.select
  let selectCalls = 0
  agent.model.select = function countedSelect(next) {
    selectCalls += 1
    return nativeSelect.call(this, next)
  }
  await host.announceAgent(agent)

  agent.session.append('turn/start', { turn: 1 })
  await host.emit('agent/inbox/claimed', { agent, message: userMessage(ENGINEERING), turn: 1 })
  const first = agent.model.current()
  const repeated = agent.model.current()
  assert.deepEqual(repeated, first, 'one capture must reuse its resolved concrete selection')
  assert.equal(first?.reasoningEffort, 'high')
  assert.equal(selectCalls, 0, 'resolving current must not append a concrete native selection')

  host.dispose()
  const recent = JSON.parse(readFileSync(file, 'utf8')).sessions[agent.id]?.recent || []
  const decisions = recent.filter((row) => row.turn === 1 && row.step === 1)
  assert.equal(decisions.length, 1, 'repeated current in one capture records exactly one actual decision')
  assert.equal(decisions[0]?.effort, 'high')
  assert.equal(decisions[0]?.mode, 'auto')
})

test('D: unresolved Auto captured at pre-step is rejected fail-closed', async (t) => {
  const { host } = modernHost()
  t.after(() => host.dispose())
  const { agent } = host.createAgent('d-unresolved-auto')
  await host.announceAgent(agent)
  let entered = false
  const decision = await host.waterfall('agent/pre-step', {
    agent,
    turn: 1,
    step: 1,
    messages: [],
    modelSelection: { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' },
  }, async () => {
    entered = true
    return { kind: 'enter', messages: [] }
  })
  assert.equal(decision.kind, 'reject')
  assert.match(decision.reason, /unresolved Auto/i)
  assert.equal(entered, false, 'an unresolved private sentinel must never reach request preparation')
  assert.equal(host.requests.length, 0)
})

test('D: an Agent without current is ignored without fabricating a selection', async (t) => {
  const { host } = modernHost()
  t.after(() => host.dispose())
  const { agent, selectionEvents } = host.createAgent('d-no-current')
  delete agent.model.current
  await assert.doesNotReject(host.announceAgent(agent))
  assert.equal(selectionEvents.length, 0)
  assert.equal(host.selectionEvents.length, 0)
  assert.equal(host.requests.length, 0)
})

test('D: applyConfiguredRoute outside a turn keeps raw Auto while capture is concrete', async (t) => {
  const { host } = modernHost({ strictAppend: true })
  t.after(() => host.dispose())
  await host.primeCapability()
  const nativeAuto = { provider: 'gw', model: 'thinker', reasoningEffort: 'auto' }
  const { agent } = host.createAgent('d-configured-route', { effort: undefined, pending: nativeAuto })
  const nativeSelect = agent.model.select
  const selected = []
  agent.model.select = function configuredRouteSelect(next) {
    selected.push({ ...next })
    return nativeSelect.call(this, next)
  }
  await host.announceAgent(agent)

  const applyConfiguredRoute = () => {
    const previous = agent.model.current()
    assert.ok(previous, 'the host must have a previous native selection')
    agent.model.select(previous)
    return previous
  }
  assert.equal(applyConfiguredRoute().reasoningEffort, 'auto', 'a wrapper must not pin a concrete default before turn/start')
  assert.equal(host.rawCurrent(agent).reasoningEffort, 'auto')

  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.selection.reasoningEffort, 'high', 'only the active preStep capture resolves concrete effort')
  assert.equal(result.config.reasoningEffort, 'high')
  assert.equal(applyConfiguredRoute().reasoningEffort, 'auto', 'turn/end restores raw selection semantics')
  assert.deepEqual(selected.map((row) => row.reasoningEffort), ['auto', 'auto'])
  assert.equal(host.selectionEvents.some((row) => row.reasoningEffort !== 'auto'), false)
})

test('D: a native manual concrete selection passes through immediately and is recorded as manual', async (t) => {
  const { host, file } = modernHost({ strictAppend: true })
  t.after(() => host.dispose())
  await host.primeCapability()
  const manual = { provider: 'gw', model: 'thinker', reasoningEffort: 'max' }
  const { agent } = host.createAgent('d-manual-concrete', { effort: 'max', pending: manual })
  await host.announceAgent(agent)
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'max')
  assert.equal(host.selectionEvents.length, 0)
  host.dispose()
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).sessions[agent.id].last.mode, 'manual')
})

test('D: native manual off takes over immediately without an Auto resurrection', async (t) => {
  const { host } = modernHost({ strictAppend: true })
  t.after(() => host.dispose())
  await host.primeCapability()
  const manualOff = { provider: 'gw', model: 'thinker', reasoningEffort: 'off' }
  const { agent } = host.createAgent('d-manual-off', { effort: 'off', pending: manualOff })
  await host.announceAgent(agent)
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'off')
  assert.equal(agent.model.current().reasoningEffort, 'off')
  assert.equal(host.selectionEvents.length, 0)
})

test('D dispose: restoring current() returns the exact original function', async (t) => {
  const { host } = modernHost()
  t.after(() => host.dispose())
  const { agent } = host.createAgent('d-dispose-current')
  const original = agent.model.current
  await host.announceAgent(agent)
  assert.notEqual(agent.model.current, original)
  host.dispose()
  assert.equal(agent.model.current, original)
})

test('D HMR: a new plugin generation wraps the restored current once and disposes symmetrically', async (t) => {
  const first = modernHost()
  const second = modernHost()
  t.after(() => { first.host.dispose(); second.host.dispose() })
  const { agent } = first.host.createAgent('d-hmr-current')
  const original = agent.model.current
  await first.host.announceAgent(agent)
  const firstWrapper = agent.model.current
  assert.notEqual(firstWrapper, original)
  first.host.dispose()
  assert.equal(agent.model.current, original)
  await second.host.announceAgent(agent)
  assert.notEqual(agent.model.current, original)
  assert.notEqual(agent.model.current, firstWrapper)
  second.host.dispose()
  assert.equal(agent.model.current, original)
})

test('D third-party wrapper: dispose deactivates our inner current without overwriting the outer wrapper', async (t) => {
  const { host } = modernHost()
  t.after(() => host.dispose())
  await host.primeCapability()
  const { agent } = host.createAgent('d-third-party-current')
  const original = agent.model.current
  await host.announceAgent(agent)
  const ours = agent.model.current
  assert.notEqual(ours, original)
  await host.emit('agent/inbox/claimed', { agent, message: userMessage(ENGINEERING), turn: 1 })
  assert.equal(agent.model.current().reasoningEffort, 'high')
  const thirdParty = function thirdPartyCurrent(...args) { return ours.apply(this, args) }
  agent.model.current = thirdParty
  host.dispose()
  assert.equal(agent.model.current, thirdParty)
  assert.equal(agent.model.current().reasoningEffort, 'auto', 'the retained old wrapper must delegate to native intent after dispose')
  assert.equal(original.call(agent.model).reasoningEffort, 'auto')
})

test('runtime: only the app-boot target itself being absent selects legacy', async () => {
  const runtime = await loadRuntimeWithAppBoot({ kind: 'target-missing' })
  assert.equal(runtime.detectRuntimeContract(), 'legacy')
})

test('runtime: an app-boot internal throw fails loud instead of installing legacy rewrites', async () => {
  await assert.rejects(
    loadRuntimeWithAppBoot({ kind: 'internal-throw', message: 'app-boot exploded internally' }),
    /app-boot exploded internally/,
  )
})

test('runtime: nested dependency ERR_MODULE_NOT_FOUND fails loud instead of installing legacy rewrites', async () => {
  await assert.rejects(
    loadRuntimeWithAppBoot({ kind: 'dependency-missing' }),
    /dsh-test-internal-missing/,
  )
})

test('T-H1: dispose + readvertise self-heals when a third party wrapped after us', async () => {
  const original = async () => ({ reasoning: { efforts: [{ id: 'low' }] } })
  const adapter = { resolveModel: original }
  const llm = { adapters: new Map([['gw', { adapter }]]) }
  const first = advertiseAutoMask(llm, { info() {} })
  const ours = adapter.resolveModel
  adapter.resolveModel = function thirdParty(...args) { return ours.apply(this, args) }
  first.dispose()
  const second = advertiseAutoMask(llm, { info() {} })
  assert.equal(second.count, 1, 'our stale marker must not suppress the replacement registration')
  second.dispose()
})

test('T-H1/FR-005: a third party retaining our old wrapper cannot inject Auto after dispose', async () => {
  const adapter = { async resolveModel() { return { reasoning: { efforts: [{ id: 'low' }] } } } }
  const llm = { adapters: new Map([['gw', { adapter }]]) }
  const registration = advertiseAutoMask(llm, { info() {} })
  const ours = adapter.resolveModel
  adapter.resolveModel = function thirdParty(...args) { return ours.apply(this, args) }
  registration.dispose()
  const info = await adapter.resolveModel('gw', 'thinker')
  assert.deepEqual(info.reasoning.efforts.map((row) => row.id), ['low'])
})

test('T-H8: malformed JSON warns, recovers empty, and still persists later decisions', () => {
  const dir = tempDir('er-store-malformed-')
  const file = join(dir, 'state.json')
  writeFileSync(file, '{not json', 'utf8')
  const warnings = []
  const store = createStore(file, { warn: (line) => warnings.push(String(line)) })
  try {
    store.record('good', entry())
    store.flush()
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).sessions.good.last.effort, 'low')
    assert.ok(warnings.some((line) => /decision store/i.test(line)), 'corrupt input must not degrade silently')
  } finally {
    store.dispose()
  }
})

test('T-H8: scalar, null, and array rows warn, are skipped, and never block a good row', async (t) => {
  for (const [name, badRow] of [['string', 'bad'], ['null', null], ['array', []]]) {
    await t.test(name, () => {
      const dir = tempDir(`er-store-row-${name}-`)
      const file = join(dir, 'state.json')
      writeFileSync(file, JSON.stringify({ version: 1, sessions: { bad: badRow, good: { last: null, recent: [] } } }))
      const warnings = []
      const store = createStore(file, { warn: (line) => warnings.push(String(line)) })
      try {
        assert.doesNotThrow(() => {
          store.record('bad', entry('low'))
          store.record('good', entry('high'))
        })
        store.flush()
        const saved = JSON.parse(readFileSync(file, 'utf8')).sessions
        assert.equal(Array.isArray(saved.bad), false)
        assert.equal(saved.bad.last.effort, 'low')
        assert.equal(saved.good.last.effort, 'high')
        assert.ok(warnings.some((line) => /decision store/i.test(line)), 'the skipped malformed row must be visible')
      } finally {
        store.dispose()
      }
    })
  }
})

test('T-H8: a __proto__ session id is own data and cannot mutate Object.prototype', () => {
  const dir = tempDir('er-store-prototype-')
  const file = join(dir, 'state.json')
  const store = createStore(file, { warn() {} })
  try {
    store.record('__proto__', entry())
    assert.equal(Object.prototype.last, undefined)
    assert.equal(Object.prototype.recent, undefined)
    assert.equal(store.last('__proto__').effort, 'low')
    store.flush()
    const sessions = JSON.parse(readFileSync(file, 'utf8')).sessions
    assert.equal(Object.hasOwn(sessions, '__proto__'), true)
  } finally {
    // The current implementation reaches this cleanup after a failed assertion
    // too, so one red test cannot poison the rest of this test process.
    delete Object.prototype.last
    delete Object.prototype.recent
    delete Object.prototype.manualOff
    store.dispose()
  }
})

test('T-H7: models[] + modelOverrides with one key produce one candidate and one filled entry', () => {
  const base = { providers: { gw: { models: [{ id: 'm' }], modelOverrides: { m: { name: 'same route' } } } } }
  assert.deepEqual(fillCandidates(base), ['gw/m'])
  assert.deepEqual(planFill(base, {}, ['gw/m']).filled, ['gw/m'])
})

test('T-H7: startup resolves a duplicated models[]/override key only once', async (t) => {
  const section = { providers: { gw: { models: [{ id: 'm' }], modelOverrides: { m: { name: 'same route' } } } } }
  const writes = []
  let resolveCalls = 0
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', base: section, user: {}, value: section, revision: 1 }],
    update: async (ns, patch, expectedRevision) => { writes.push({ ns, patch, expectedRevision }) },
  }
  const { host } = modernHost({
    services: new Map([['settings', settings]]),
    modelInfo: async () => { resolveCalls += 1; return {} },
  })
  t.after(() => host.dispose())
  for (let index = 0; index < 20 && writes.length === 0; index += 1) await settle()
  assert.equal(writes.length, 1)
  assert.equal(resolveCalls, 1)
})

test('T-H6/FR-050: user provider compat=false wins over automatic row compat=true', () => {
  const base = { providers: { gw: { api: 'openai-completions', models: [{ id: 'm' }] } } }
  const user = { providers: { gw: { compat: { supportsReasoningEffort: false } } } }
  const result = planFill(base, user, ['gw/m'])
  assert.equal(result.providers.gw.models[0].compat?.supportsReasoningEffort, false)
})

test('FR-040 cold Auto: public agent/created prewarms capability without awaiting the resolver', async (t) => {
  let resolveInfo
  const gate = new Promise((resolve) => { resolveInfo = resolve })
  const { host } = modernHost({ modelInfo: async () => { await gate; return LEVELS } })
  t.after(() => host.dispose())
  const { agent } = host.createAgent('created-prewarm')
  let announced = false
  const announcing = host.announceAgent(agent).then(() => { announced = true })
  await Promise.resolve()
  assert.equal(announced, true, 'agent creation must remain fail-open and non-blocking')
  resolveInfo(LEVELS)
  await announcing
  await settle()
  await settle()
  const result = await host.runStep(agent, { claimed: [userMessage(ENGINEERING)] })
  assert.equal(result.config.reasoningEffort, 'high', 'the first Auto request should see the prewarmed capability')
})
