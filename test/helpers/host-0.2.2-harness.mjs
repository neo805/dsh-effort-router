/**
 * Executable 0.2.2 host-contract fixture, not a real-host acceptance substitute.
 *
 * Contract sources: dsh-agent-loop/lib/index.js:103-110,666-713,723-824,
 * 833-1044 and dsh-agent/lib/index.js:190-203,328-398. In particular:
 * claimed is synchronous, selection is captured before pre-step, retries keep
 * that selection, prepareCall resolves the adapter request, request/header is
 * deduplicated, and step/end + turn/end are emitted from finally blocks.
 */
import { registerHooks } from 'node:module'
import '../test-profile.mjs'

const RUNTIME = Symbol.for('dsh-effort-router.test.runtime-version')
let hooksInstalled = false
let appBootSequence = 0
let activeAppBootCase = null
const appBootCases = new Map()

function installAppBootHook() {
  if (hooksInstalled) return
  hooksInstalled = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-app-boot') {
        const id = activeAppBootCase
        if (id !== null && appBootCases.get(id)?.kind === 'target-missing') {
          throw Object.assign(new Error("Cannot find package '@deepseek-ai/dsh-app-boot'"), { code: 'ERR_MODULE_NOT_FOUND' })
        }
        return { url: `effort-router-test:app-boot${id === null ? '' : `?case=${id}`}`, shortCircuit: true }
      }
      if (specifier === 'dsh-test-internal-missing') {
        throw Object.assign(new Error("Cannot find package 'dsh-test-internal-missing'"), { code: 'ERR_MODULE_NOT_FOUND' })
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url.startsWith('effort-router-test:app-boot')) {
        const id = new URL(url).searchParams.get('case')
        const testCase = id === null ? null : appBootCases.get(Number(id))
        let source = `export function getDshRuntimeVersion() { return globalThis[Symbol.for('dsh-effort-router.test.runtime-version')] }`
        if (testCase?.kind === 'internal-throw') source = `throw new Error(${JSON.stringify(testCase.message || 'app-boot internal failure')})`
        if (testCase?.kind === 'dependency-missing') source = `await import('dsh-test-internal-missing')`
        return { format: 'module', source, shortCircuit: true }
      }
      return nextLoad(url, context)
    },
  })
}

/** Mock only the documented app-boot package boundary, never ctx.version. */
export async function loadApplyForRuntime(version) {
  globalThis[RUNTIME] = version
  activeAppBootCase = null
  installAppBootHook()
  // Each test file is a separate node:test process; this query also makes the
  // selected runtime explicit in diagnostics instead of sharing a hidden ESM
  // cache with the legacy suite.
  return import(`../../lib/index.js?contract-runtime=${encodeURIComponent(version)}`)
}

export async function loadRuntimeWithAppBoot(testCase = {}) {
  appBootSequence += 1
  const id = appBootSequence
  appBootCases.set(id, testCase)
  activeAppBootCase = id
  installAppBootHook()
  return import(`../../lib/runtime.js?app-boot-case=${id}`)
}

export function setTestRuntimeVersion(version) { globalThis[RUNTIME] = version }

let sequence = 0
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const effortOf = (selection) => selection && typeof selection.reasoningEffort === 'string'
  ? selection.reasoningEffort : undefined
const selectionOf = (config) => config ? {
  provider: config.provider,
  model: config.model,
  reasoningEffort: config.reasoningEffort,
} : undefined
const aborted = (signal) => {
  if (signal && signal.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' })
}
const defaultStream = async ({ signal }) => { aborted(signal) }

export const ENGINEERING = '重构整个状态机，设计完整架构并修复多个模块之间的数据竞态，给出迁移和回滚方案。'
export const TRIVIAL = '改一下按钮文案'

export function userMessage(text = '请解释这个项目', origin = 'user') {
  sequence += 1
  return {
    id: `user-${sequence}`,
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
    origin,
  }
}
export function assistantToolCall(callId = 'call-1', name = 'lookup') {
  sequence += 1
  return { id: `assistant-${sequence}`, role: 'assistant', content: [{ type: 'tool-call', callId, name, args: { query: 'same' } }] }
}
export function toolResult(text = 'ok', isError = false, callId = 'call-1') {
  sequence += 1
  return {
    id: `tool-${sequence}`, role: 'tool', toolCallId: callId, isError,
    content: [{ type: 'text', text }], source: { kind: 'tool', callId },
  }
}

export function createModernHost(options = {}) {
  const disposers = []
  const listeners = new Map()
  const agents = new Set()
  const turnStates = new Map()
  const rawCurrents = new WeakMap()
  const requests = []
  const selectionCaptures = []
  const selectionEvents = []
  const logs = []
  const eventErrors = []
  let disposed = false
  let agentSequence = 0

  const adapters = options.adapters || new Map([['gw', {
    async resolveModelInfo(provider, model) {
      if (typeof options.modelInfo === 'function') return options.modelInfo(provider, model)
      return options.modelInfo || {
        reasoning: {
          default: 'low',
          efforts: ['low', 'medium', 'high', 'max'].map((id) => ({ id })),
        },
      }
    },
  }]])
  const llm = options.llm || {
    adapters,
    async resolveModelInfo(provider, model) {
      if (options.resolvePending) await options.resolvePending
      if (options.unsupported) return null
      const adapter = adapters.get(provider)
      if (!adapter) return null
      const info = await adapter.resolveModelInfo(provider, model)
      if (!info || !info.reasoning || !Array.isArray(info.reasoning.efforts)) return info
      const ids = info.reasoning.efforts.map((row) => typeof row === 'string' ? row : row && row.id)
      return options.offOnly
        ? { reasoning: { efforts: [{ id: 'off' }, { id: 'auto' }] } }
        : { ...info, reasoning: { ...info.reasoning, efforts: [{ id: 'auto' }, { id: 'off' }, ...ids.map((id) => ({ id }))] } }
    },
  }
  if (typeof llm.prepareCall !== 'function') {
    llm.prepareCall = async (config, signal) => {
      aborted(signal)
      return { config: clone(config), adapterDefaults: {}, stream: defaultStream }
    }
  }

  const logger = {
    info(message) { logs.push(String(message)) },
    warn(message) { logs.push(String(message)) },
  }
  const services = options.services || new Map()
  if (!services.has('settings')) services.set('settings', { describe: () => [], update: async () => {} })
  if (!services.has('profileContext')) services.set('profileContext', { name: 'contract', dir: null })
  if (!services.has('llm')) services.set('llm', llm)
  if (!services.has('sessionProjections')) services.set('sessionProjections', {
    stateOf(session, name) { return session.projection(name) },
    cachedSnapshot() { return null },
    register() { return () => {} },
  })
  if (!services.has('webServer')) services.set('webServer', { register() { return () => {} } })
  if (typeof services.get === 'function' && !services.get('sessions')) services.set('sessions', { list: () => [...agents].map((agent) => agent.session) })

  const ctx = {
    logger,
    get(name) {
      const found = typeof services.get === 'function' ? services.get(name) : undefined
      if (!found) throw new Error('no service ' + name)
      return found
    },
    on(name, listener, onOptions = {}) {
      const list = listeners.get(name) || []
      const row = { listener, prepend: onOptions.prepend === true }
      if (row.prepend) list.unshift(row)
      else list.push(row)
      listeners.set(name, list)
      return () => {
        const current = listeners.get(name) || []
        const index = current.indexOf(row)
        if (index >= 0) current.splice(index, 1)
      }
    },
    inject(names, fn) {
      const scope = { effect: ctx.effect }
      for (const name of names) scope[name] = ctx.get(name)
      const dispose = fn(scope)
      if (typeof dispose === 'function') disposers.push(dispose)
      return typeof dispose === 'function' ? dispose : () => {}
    },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
  }
  // Real host events carry more than one argument (session/event is
  // (session, event)); forwarding only the first argument silently starved
  // every session/event listener.
  const emit = (name, ...args) => {
    const outcomes = []
    for (const { listener } of [...(listeners.get(name) || [])]) {
      try { outcomes.push(listener(...args)) } catch (error) { outcomes.push(Promise.reject(error)) }
    }
    return Promise.all(outcomes)
  }
  const fire = (name, ...args) => { emit(name, ...args).catch((error) => eventErrors.push(error)) }
  const waterfall = (name, payload, terminal) => {
    const entries = [...(listeners.get(name) || [])]
    const chain = entries.reduceRight((next, { listener }) => (
      (current) => listener(current, () => next(current))
    ), terminal)
    return chain(payload)
  }

  function rememberRawCurrent(agent) {
    if (rawCurrents.has(agent)) return
    if (!agent || !agent.model || typeof agent.model.current !== 'function') return
    rawCurrents.set(agent, agent.model.current.bind(agent.model))
  }

  function rawCurrent(agent) {
    const current = rawCurrents.get(agent)
    if (!current) throw new Error('rawCurrent requires an Agent created or announced by this host')
    return current()
  }

  function createAgent(id, agentOptions = {}) {
    agentSequence += 1
    const sessionId = id || `modern-${agentSequence}`
    const events = []
    const headers = []
    const messages = []
    let pending = clone(agentOptions.pending) || null
    let lastUsed = clone(agentOptions.lastUsed) || null
    let requestHeader
    let appending = false
    const selections = []
    let session
    const explicitOptions = agentOptions.options || {}
    const optionDescriptor = (key, fallback) => {
      if (key === 'reasoningEffort' && Object.prototype.hasOwnProperty.call(agentOptions, 'effort')) {
        return { value: agentOptions.effort }
      }
      if (Object.prototype.hasOwnProperty.call(explicitOptions, key)) return { value: explicitOptions[key] }
      // DSH rc3 agentOptions exposes the native global selection through live
      // getters. This fixture only models that public boundary; selectModel()
      // below replaces the complete global default, with auto as an ordinary id.
      if (options.nativeDefaults) return { get: () => options.nativeDefaults[key] }
      return { value: fallback }
    }
    const agent = { id: sessionId, sessionId, options: {} }
    for (const [key, fallback] of [['provider', 'gw'], ['model', 'thinker'], ['reasoningEffort', 'auto']]) {
      Object.defineProperty(agent.options, key, {
        enumerable: true, configurable: true, ...optionDescriptor(key, fallback),
      })
    }
    for (const [key, value] of Object.entries(explicitOptions)) {
      if (!['provider', 'model', 'reasoningEffort'].includes(key)) agent.options[key] = value
    }
    const fold = (event) => {
      if (event.type === 'model/selection') pending = clone(event.data)
      if (event.type === 'request/header') {
        requestHeader = event.data.header
        const current = selectionOf(requestHeader && requestHeader.config)
        if (current && JSON.stringify(current) === JSON.stringify(pending)) pending = null
        lastUsed = current
      }
      if (event.type === 'session/requestHeader') {
        if (event.data && event.data.header !== undefined) requestHeader = event.data.header
      }
    }
    session = {
      id: sessionId,
      header: clone(agentOptions.header) || {},
      get seq() { return events.length },
      events,
      messages,
      append(type, data) {
        if (options.strictAppend === true && appending) {
          throw new Error('session append cannot reenter while another append is being published')
        }
        const event = { seq: events.length + 1, type, data: clone(data) }
        appending = true
        try {
          events.push(event)
          fold(event)
          if (type === 'model/selection') {
            selections.push(clone(data))
            selectionEvents.push({ agentId: sessionId, ...clone(data) })
          }
          fire('session/event', session, event)
          return event
        } finally {
          appending = false
        }
      },
      appendRequestHeader(header) {
        if (options.strictAppend === true && appending) {
          throw new Error('session append cannot reenter while another append is being published')
        }
        const event = { seq: events.length + 1, type: 'session/requestHeader', data: { header: clone(header) } }
        appending = true
        try {
          events.push(event)
          fold(event)
          fire('session/event', session, event)
          return event
        } finally {
          appending = false
        }
      },
      requestHeader() { return requestHeader },
      deriveMessages() { return [...messages] },
      snapshotEvents() { return [...events] },
      projection(name) {
        if (name === 'modelSelection') return { version: 3, pending: clone(pending), lastUsed: clone(lastUsed) }
        return null
      },
    }
    agent.session = session
    agent.model = {
      current() {
        const value = pending || lastUsed || agent.options
        return value ? clone(value) : undefined
      },
      select(next) {
        if (next && typeof next === 'object' && typeof next.provider === 'string' && typeof next.model === 'string') {
          const recorded = pending || lastUsed
          if (JSON.stringify(next) === JSON.stringify(recorded)) return
          session.append('model/selection', next)
        }
      },
    }
    if (options.modelSelect === false || agentOptions.modelSelect === false) delete agent.model.select
    // Replacing a branch/session generation reuses the public session id but
    // must not inherit the old turn cursor. The old agent remains usable by an
    // in-flight request so late completion can be tested against the new one.
    for (const existing of [...agents]) {
      if (existing.id === sessionId) agents.delete(existing)
    }
    turnStates.delete(sessionId)
    agents.add(agent)
    rememberRawCurrent(agent)
    return { agent, session, events, selectionEvents: selections }
  }

  async function runStep(agent, run = {}) {
    const session = agent.session
    const previousTurn = turnStates.get(agent.id)
    const turn = previousTurn ? previousTurn.turn : (run.turn === undefined ? 1 : run.turn)
    const step = run.step === undefined ? (previousTurn ? previousTurn.step + 1 : 1) : run.step
    const signal = run.signal
    const claimed = run.claimed === undefined
      ? (previousTurn || run.continues === true ? [] : [userMessage()])
      : run.claimed
    const priorTools = run.toolResult ? [run.toolResult] : []
    const settlingTools = run.toolResults || []
    const maxAttempts = run.maxAttempts || 2
    let turnStarted = false
    let stepStarted = false
    let keepTurnOpen = false
    let prepared
    const turnState = previousTurn || { turn, step }
    turnState.step = step
    try {
      if (!previousTurn) {
        session.append('turn/start', { turn })
        turnStates.set(agent.id, turnState)
      }
      turnStarted = true
      if (claimed.length) {
        // Claim removes pending inbox entries durably before the synchronous
        // notification. User/tool messages are NOT admitted to the model-visible
        // session until after prepareRequest/prepareCall below.
        session.append('agent/inbox/spliced', {
          target: previousTurn || run.continues === true ? 'next-step' : 'next-turn',
          start: 0, removedCount: claimed.length, inserted: [],
        })
        for (const message of claimed) {
          // Synchronous public hook, then immediate current(): no microtask may
          // slip between the claim and the frozen per-step selection.
          fire('agent/inbox/claimed', { agent, message, turn })
        }
      }
      if (priorTools.length) session.messages.push(...priorTools)
      aborted(signal)
      const selection = agent.model.current()
      selectionCaptures.push({ agentId: agent.id, turn, step, selection: clone(selection) })
      const preDecision = await waterfall('agent/pre-step', {
        agent, turn, step, messages: claimed, signal,
        modelSelection: clone(selection),
      }, async () => ({ kind: 'enter', messages: claimed }))
      if (preDecision && preDecision.kind === 'reject') {
        return { ...preDecision, selection: clone(selection), config: clone(selection), attempts: 0 }
      }
      aborted(signal)
      session.append('step/start', { turn, step })
      stepStarted = true
      const decision = { turn, step, selection: clone(selection) }
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        // prepareRequest/prepareCall and stream iteration errors are outside the
        // host's request-error retry protocol and must propagate directly.
        const proposed = await waterfall('agent/request', {
          agent, turn, step, signal,
        }, async () => clone(decision.selection))
        aborted(signal)
        if (!proposed || proposed.provider !== decision.selection.provider || proposed.model !== decision.selection.model) {
          throw new Error(`agent/request proposed a different provider/model after step preparation fixed ${decision.selection.provider}/${decision.selection.model}; use agent.model.select() before step preparation.`)
        }
        const before = effortOf(decision.selection)
        const after = proposed.reasoningEffort
        if (before !== after) {
          const change = before === undefined ? 'add' : after === undefined ? 'delete' : 'change'
          throw new Error(`agent/request proposed reasoning effort ${JSON.stringify(after)} (${change}) after step preparation fixed ${JSON.stringify(before)}; use agent.model.select() before step preparation.`)
        }
        prepared = await llm.prepareCall(clone(proposed), signal)
        aborted(signal)
        const resolved = prepared && prepared.config ? prepared.config : proposed
        // Admission follows preparation and happens only on the first attempt.
        if (attempt === 1 && claimed.length) session.messages.push(...claimed)
        requests.push({
          agentId: agent.id, turn, step, attempt,
          provider: resolved.provider, model: resolved.model,
          reasoningEffort: resolved.reasoningEffort,
          config: clone(resolved), adapterDefaults: clone(prepared && prepared.adapterDefaults),
        })
        const header = {
          config: clone(resolved), adapterDefaults: clone(prepared && prepared.adapterDefaults),
        }
        const headerKey = JSON.stringify({ config: header.config, adapterDefaults: header.adapterDefaults })
        const baseline = session.requestHeader()
        const baselineKey = baseline
          ? JSON.stringify({ config: baseline.config, adapterDefaults: baseline.adapterDefaults })
          : undefined
        if (!agent.__requestHeaderLogged || baselineKey !== headerKey) {
          session.append('request/header', {
            header, reason: agent.__requestHeaderLogged ? 'change' : baseline ? 'resume' : 'initial',
          })
        }
        agent.__requestHeaderLogged = true
        aborted(signal)
        const streamFactory = prepared && typeof prepared.stream === 'function' ? prepared.stream : defaultStream
        const stream = streamFactory({ signal, config: resolved, attempt })
        let finish = { kind: 'stop' }
        if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
          for await (const chunk of stream) {
            aborted(signal)
            if (chunk && chunk.type === 'finish' && chunk.reason) finish = chunk.reason
          }
        } else {
          await stream
        }
        aborted(signal)
        if (finish.kind === 'error' || finish.kind === 'aborted') {
          const failure = finish.failure || { message: 'stream failed', code: 'STREAM_ERROR' }
          // The public waterfall returns { kind: 'retry' }; listener arrays,
          // boolean retry flags and thrown preparation errors are not protocol.
          const action = await waterfall('agent/request-error', {
            agent, turn, step, provider: resolved.provider,
            failure, retryPolicy: prepared && prepared.retryPolicy, signal,
          }, async () => undefined)
          aborted(signal)
          if (action && action.kind === 'retry' && attempt < maxAttempts) continue
          const error = failure instanceof Error ? failure : new Error(failure.message || 'stream failed')
          if (!(failure instanceof Error)) { error.code = failure.code; error.failure = failure }
          throw error
        }
        session.messages.push(run.assistantMessage || run.assistant || assistantToolCall(), ...settlingTools)
        keepTurnOpen = run.continues === true
        return { ...prepared, config: clone(resolved), selection: clone(decision.selection), attempts: attempt }
      }
      throw new Error('unreachable retry loop')
    } finally {
      if (stepStarted) {
        session.append('step/end', { turn, step })
        if (typeof run.afterStepEnd === 'function') await run.afterStepEnd()
      }
      if (turnStarted && !keepTurnOpen) {
        if (turnStates.get(agent.id) === turnState) turnStates.delete(agent.id)
        session.append('turn/end', { turn })
        if (typeof run.afterTurnEnd === 'function') await run.afterTurnEnd()
      }
    }
  }

  async function runContinuousTurn(agent, run = {}) {
    const session = agent.session
    const specs = run.steps || [{}]
    const results = []
    const turnState = { turn: run.turn === undefined ? 1 : run.turn, step: 0 }
    turnStates.set(agent.id, turnState)
    session.append('turn/start', { turn: turnState.turn })
    let stepStarted = false
    try {
      for (let index = 0; index < specs.length; index += 1) {
        const spec = specs[index] || {}
        const turn = turnState.turn
        const step = index + 1
        turnState.step = step
        const claimed = spec.claimed === undefined
          ? (index === 0 ? (run.claimed || [userMessage()]) : [])
          : spec.claimed
        if (claimed.length) {
          session.append('agent/inbox/spliced', {
            target: index === 0 ? 'next-turn' : 'next-step',
            start: 0, removedCount: claimed.length, inserted: [],
          })
          for (const message of claimed) fire('agent/inbox/claimed', { agent, message, turn })
        }
        // This capture intentionally precedes every await. In particular, the
        // previous iteration's step/end microtasks have not run when a tool
        // continuation reaches this line with claimed=[].
        const selection = agent.model.current()
        selectionCaptures.push({ agentId: agent.id, turn, step, selection: clone(selection) })
        const preDecision = await waterfall('agent/pre-step', {
          agent, turn, step, messages: claimed, signal: run.signal,
          modelSelection: clone(selection),
        }, async () => ({ kind: 'enter', messages: claimed }))
        if (preDecision && preDecision.kind === 'reject') {
          return [...results, { ...preDecision, selection: clone(selection), config: clone(selection), attempts: 0 }]
        }
        session.append('step/start', { turn, step })
        stepStarted = true
        const proposed = await waterfall('agent/request', {
          agent, turn, step, signal: run.signal,
        }, async () => clone(selection))
        if (!proposed || proposed.provider !== selection.provider || proposed.model !== selection.model) {
          throw new Error('agent/request changed provider/model after preStep selection capture')
        }
        if (proposed.reasoningEffort !== selection.reasoningEffort) {
          throw new Error('agent/request changed reasoningEffort after preStep selection capture')
        }
        const prepared = await llm.prepareCall(clone(proposed), run.signal)
        const resolved = prepared && prepared.config ? prepared.config : proposed
        if (claimed.length) session.messages.push(...claimed)
        requests.push({
          agentId: agent.id, turn, step, attempt: 1,
          provider: resolved.provider, model: resolved.model,
          reasoningEffort: resolved.reasoningEffort,
          config: clone(resolved), adapterDefaults: clone(prepared && prepared.adapterDefaults),
        })
        const header = { config: clone(resolved), adapterDefaults: clone(prepared && prepared.adapterDefaults) }
        const headerKey = JSON.stringify({ config: header.config, adapterDefaults: header.adapterDefaults })
        const baseline = session.requestHeader()
        const baselineKey = baseline
          ? JSON.stringify({ config: baseline.config, adapterDefaults: baseline.adapterDefaults })
          : undefined
        if (!agent.__requestHeaderLogged || baselineKey !== headerKey) {
          session.append('request/header', {
            header, reason: agent.__requestHeaderLogged ? 'change' : baseline ? 'resume' : 'initial',
          })
        }
        agent.__requestHeaderLogged = true
        session.messages.push(
          spec.assistantMessage || spec.assistant || assistantToolCall(),
          ...(spec.toolResults || []),
        )
        results.push({ ...prepared, config: clone(resolved), selection: clone(selection), attempts: 1 })
        session.append('step/end', { turn, step })
        stepStarted = false
        // Do not await here: this is the real tool-continuation edge.
      }
      return results
    } finally {
      if (stepStarted) session.append('step/end', { turn: turnState.turn, step: turnState.step })
      if (turnStates.get(agent.id) === turnState) turnStates.delete(agent.id)
      session.append('turn/end', { turn: turnState.turn })
    }
  }

  async function primeCapability(prime = {}) {
    const effort = prime.effort || 'high'
    const { agent } = createAgent(prime.id || `capability-prime-${agentSequence + 1}`, {
      options: { provider: prime.provider || 'gw', model: prime.model || 'thinker', reasoningEffort: effort },
    })
    // A concrete manual step drives the plugin's real public resolver. No
    // cache peek, private capability call, or fabricated synchronous miss.
    await runStep(agent, { claimed: [userMessage('预热能力解析')], maxAttempts: 1 })
    requests.length = 0
    selectionCaptures.length = 0
    logs.length = 0
    return agent
  }

  async function announceAgent(agent, source = 'fresh', signal) {
    rememberRawCurrent(agent)
    // The public agent/created seam is serial and awaited by the real registry.
    // Keeping it opt-in preserves the existing synchronous createAgent fixture.
    for (const { listener } of [...(listeners.get('agent/created') || [])]) {
      // Only a listener that actually returns a promise may suspend creation.
      // Awaiting a synchronous listener would add a microtask of latency and
      // make "creation stays non-blocking" indistinguishable from "creation
      // blocks on the resolver", which is exactly what FR-040 pins down.
      const pending = listener({ agent, source, ...(signal === undefined ? {} : { signal }) })
      if (pending && typeof pending.then === 'function') await pending
    }
    return agent
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const list of listeners.values()) list.length = 0
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try { disposers[index]() } catch (error) { eventErrors.push(error) }
    }
  }

  const api = {
    ctx, llm, services, logs, requests, selectionCaptures, selectionEvents, eventErrors,
    createAgent, announceAgent, rawCurrent, runStep, runContinuousTurn, primeCapability, emit, waterfall, dispose,
    selectModel(next) {
      if (!options.nativeDefaults) throw new Error('nativeDefaults fixture was not enabled')
      if (!next || typeof next.provider !== 'string' || typeof next.model !== 'string' || typeof next.reasoningEffort !== 'string') {
        throw new TypeError('selectModel requires a complete provider/model/reasoningEffort selection')
      }
      options.nativeDefaults.provider = next.provider
      options.nativeDefaults.model = next.model
      options.nativeDefaults.reasoningEffort = next.reasoningEffort
      return clone(options.nativeDefaults)
    },
    defaultSelection() { return options.nativeDefaults ? clone(options.nativeDefaults) : undefined },
    listenerCount(name) { return (listeners.get(name) || []).length },
    apply(config = {}) {
      if (typeof options.apply !== 'function') throw new Error('loadApplyForRuntime() must supply the public apply()')
      return options.apply(ctx, config)
    },
  }
  if (options.autoApply !== false) api.apply(options.config || {})
  return api
}
