/**
 * dsh-effort-router — 0.2.2 agent-loop Auto capture (modern contract).
 *
 * The 0.2.2 loop captures `agent.model.current()` immediately after the
 * (synchronous) claim and BEFORE `agent/pre-step`; `agent/request` results are
 * compared against that capture and a mismatch is a protocol error. The only
 * seam is therefore the value `current()` returns at capture time.
 *
 * Design (DEVELOPMENT-PLAN G-01 option D): wrap the per-Agent public
 * `model.current()` so that, while a turn is active, the logical Auto sentinel
 * is synchronously resolved to the concrete effort for that step. The durable
 * native selection is never rewritten for scheduled Auto — it keeps saying
 * 'auto' (the raw intent), the request/header projection records the concrete
 * value that was actually sent, and turn/end simply closes the capture window.
 *
 * Writes still happen, but only where they are the user's durable intent:
 * a pinned `defaultLevel` and a fixed `subagentEffort` are materialized once
 * through `agent.model.select()`; a manual pick is never touched.
 *
 * Everything on the capture path is synchronous: claimed, the capture itself
 * and step/end never await. Capability resolution is peeked; a miss is answered
 * with the safe omission (no effort) and warmed in the background.
 */

export function createTurnAuto(opts) {
  const plan = opts && typeof opts.plan === 'function' ? opts.plan : null
  const resolveCapability = opts && typeof opts.resolveCapability === 'function' ? opts.resolveCapability : null
  const isDisposed = opts && typeof opts.isDisposed === 'function' ? opts.isDisposed : () => false
  const logger = opts && opts.logger
  let disposed = false

  const warn = (message) => {
    try {
      if (logger && typeof logger.warn === 'function') logger.warn('[effort-router] ' + message)
    } catch (_ignore) { /* logging is advisory */ }
  }

  /** session -> record (sessions are unique per Agent in the host). */
  const records = new WeakMap()
  /** Every wrapper this controller installed, for symmetric disposal. */
  const installed = []

  const recordOf = (agent) => {
    let entry = records.get(agent)
    if (!entry) {
      entry = {
        agent,
        session: (agent && agent.session) || null,
        native: null,
        wrapper: null,
        state: {
          turn: 0, step: 1, active: false, cacheKey: '', capture: null, planned: null,
          stamped: false, lastDurable: null, restore: null, restoreFrom: null,
        },
        bySession: null,
      }
      records.set(agent, entry)
    }
    return entry
  }

  /** session object -> entry, so session/event can find the Agent's state. */
  const bySession = new WeakMap()

  const readRawSelection = (agent) => {
    const entry = agent ? records.get(agent) : null
    const model = agent && agent.model
    const reader = entry && entry.native
      ? entry.native
      : model && typeof model.current === 'function' ? model.current : null
    if (!reader) return null
    try {
      return reader.call(model)
    } catch (_unreadable) {
      return null
    }
  }

  const sameSelection = (a, b) => {
    if (!a || !b) return false
    return a.provider === b.provider && a.model === b.model
      && (a.reasoningEffort === undefined ? undefined : a.reasoningEffort)
        === (b.reasoningEffort === undefined ? undefined : b.reasoningEffort)
  }

  const ownSelection = (selection) => (selection ? {
    provider: selection.provider,
    model: selection.model,
    reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined,
  } : null)

  const pendingEffortOf = (agent) => {
    try {
      const session = agent && agent.session
      const projection = session && typeof session.projection === 'function'
        ? session.projection('modelSelection')
        : null
      const pending = projection && projection.pending
      return pending ? pending.reasoningEffort : undefined
    } catch (_unreadable) {
      return undefined
    }
  }

  /**
   * Materialize the durable selection this turn should end on.
   *
   * The host may legitimately overwrite its "last used" state from the request
   * header we sent (a stripped inherited level, a safe omission, or the
   * concrete effort a scheduled Auto resolved to). Those are request facts, not
   * the user's pick, so once the turn closes the logical selection returns to
   * the intent the turn started from: Auto for scheduled Auto, the inherited
   * level for a stripped manual pick.
   *
   * Deferred by one microtask because turn/end is published while the host is
   * still inside its append (re-entering it would be a protocol violation), and
   * skipped when the user picked something else in the meantime.
   */
  const restoreDurable = (entry, target, expected) => {
    if (!target) return
    const agent = entry.agent
    const wanted = target === 'auto'
      ? (() => {
        const raw = readRawSelection(agent)
        if (!raw || typeof raw.provider !== 'string' || typeof raw.model !== 'string') return null
        return { provider: raw.provider, model: raw.model, reasoningEffort: 'auto' }
      })()
      : ownSelection(target)
    if (!wanted) return
    queueMicrotask(() => {
      if (disposed || isDisposed()) return
      const model = agent && agent.model
      if (!model || typeof model.select !== 'function') return
      if (entry.wrapper && model.current !== entry.wrapper) return
      const raw = readRawSelection(agent)
      if (process.env.DSH_ER_DEBUG) console.error('RESTORE', JSON.stringify({target, wanted, expected, raw}))
      if (!raw || raw.provider !== wanted.provider || raw.model !== wanted.model) return
      if (sameSelection(raw, wanted)) return
      // Only undo our own header echo: if the selection moved away from what
      // this turn captured, the user (or a later host write) owns it now.
      if (expected && !sameSelection(raw, expected)) return
      try {
        model.select(wanted)
      } catch (error) {
        warn('could not restore the durable selection: ' + String((error && error.message) || error))
      }
    })
  }

  /** Durably materialize a pinned default / fixed subagent level exactly once. */
  const writeDurable = (agent, selection) => {
    const entry = records.get(agent)
    const model = agent && agent.model
    if (!entry || !model || typeof model.select !== 'function') return
    if (sameSelection(readRawSelection(agent), selection)) return
    try {
      model.select(selection)
      entry.state.lastDurable = ownSelection(selection)
    } catch (error) {
      warn('could not persist the fixed effort selection: ' + String((error && error.message) || error))
    }
  }

  const ensureCapability = (provider, model) => {
    if (!resolveCapability || typeof provider !== 'string' || typeof model !== 'string') return
    try {
      // Fire-and-forget: the capture path must never await. A rejection is
      // swallowed on purpose — the resolver answers conservatively and does
      // not cache the failure, so the next step can recover.
      Promise.resolve(resolveCapability(provider, model)).catch(() => {})
    } catch (_ignore) { /* resolver is fail-open */ }
  }

  /**
   * Resolve (once) the capture selection of the current step. Called from the
   * wrapped current(); returns null to delegate to the native value.
   */
  const captureFor = (agent) => {
    const entry = records.get(agent)
    if (!entry) return null
    const state = entry.state
    if (!state.active) return null
    const key = String(state.turn) + ':' + String(state.step)
    if (state.cacheKey === key) return state.capture
    state.cacheKey = key
    state.capture = null
    state.planned = null
    state.restore = null
    if (!plan) return null
    let planned
    try {
      planned = plan(agent, { turn: state.turn, step: state.step, agent }, 'claim', state)
    } catch (error) {
      warn('step planning failed; the native selection is used unchanged: '
        + String((error && error.message) || error))
      return null
    }
    if (!planned || !planned.write) return null
    if (planned.durable) writeDurable(agent, planned.write)
    state.planned = planned
    state.capture = ownSelection(planned.write)
    state.restore = planned.restore || null
    state.restoreFrom = state.restore ? state.capture : null
    return state.capture
  }

  const install = (agent) => {
    const model = agent && agent.model
    if (!model || typeof model.current !== 'function') return null
    const entry = recordOf(agent)
    if (entry.wrapper) {
      // Re-entrant install (HMR or a second host): only replace a wrapper that
      // is still the one we installed.
      if (model.current === entry.wrapper) return entry
      return null
    }
    const native = model.current
    const wrapper = function effortRouterCurrent(...args) {
      const raw = native.apply(model, args)
      if (disposed || isDisposed() || !entry.state.active) return raw
      const capture = captureFor(agent)
      return capture || raw
    }
    wrapper.effortRouterWrapper = true
    entry.native = native
    entry.wrapper = wrapper
    try {
      model.current = wrapper
    } catch (_readonly) {
      entry.wrapper = null
      entry.native = null
      return null
    }
    if (entry.session && !bySession.get(entry.session)) bySession.set(entry.session, entry)
    installed.push(entry)
    return entry
  }

  /**
   * Make the logical Auto intent durable in the native selection state once per
   * turn, so the composer projection keeps showing Auto while the request
   * itself carries concrete efforts. Skipped for subagents (their Auto is the
   * parent's scheduled level, not a user intent).
   */
  const stampLogicalAuto = (agent) => {
    const entry = records.get(agent)
    if (!entry || entry.state.stamped) return
    entry.state.stamped = true
    const raw = readRawSelection(agent)
    if (!raw || typeof raw.provider !== 'string' || typeof raw.model !== 'string') return
    if (raw.reasoningEffort !== 'auto') return
    if (pendingEffortOf(agent) !== undefined) return
    const session = agent.session
    if (!session || typeof session.append !== 'function') return
    try {
      session.append('model/selection', {
        provider: raw.provider,
        model: raw.model,
        reasoningEffort: 'auto',
      })
    } catch (error) {
      warn('could not record the logical Auto intent: ' + String((error && error.message) || error))
    }
  }

  const beginTurn = (agent, payload) => {
    const entry = recordOf(agent)
    const state = entry.state
    const turn = payload && typeof payload.turn === 'number' ? payload.turn : state.turn
    if (!state.active || turn !== state.turn) {
      state.turn = turn
      state.step = 1
      state.active = true
      state.stamped = false
      state.restore = null
      state.cacheKey = ''
      state.capture = null
      state.planned = null
    }
    install(agent)
    stampLogicalAuto(agent)
  }

  const advance = (entry, mutate) => {
    const state = entry.state
    mutate(state)
    state.cacheKey = ''
    state.capture = null
    state.planned = null
  }

  return {
    /** The raw native selection, for the planner (never the wrapper). */
    readNative(agent) {
      return readRawSelection(agent)
    },

    /** The host created (announced) an Agent: wrap it and prewarm capability. */
    created(agent) {
      if (disposed || isDisposed()) return
      // Never reject or await: creation stays fail-open. An Agent without a
      // readable current() is simply not ours to wrap.
      const entry = install(agent)
      if (!entry) return
      const raw = readRawSelection(agent)
      if (raw && typeof raw.provider === 'string' && typeof raw.model === 'string') {
        ensureCapability(raw.provider, raw.model)
      }
    },

    claimed(payload) {
      if (disposed || isDisposed()) return
      const agent = payload && payload.agent
      if (!agent) return
      beginTurn(agent, payload)
    },

    preStep(event, next) {
      if (disposed || isDisposed()) return next()
      const agent = event && event.agent
      if (agent) install(agent)
      const selection = event && event.modelSelection
      if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
        return next()
      }
      if (selection.reasoningEffort === 'auto') {
        return {
          kind: 'reject',
          reason: '[effort-router] unresolved Auto at step preparation: the private sentinel must be '
            + 'resolved to a concrete level before agent/request (fail-closed).',
        }
      }
      return next()
    },

    sessionEvent(session, event) {
      if (disposed || isDisposed()) return
      if (!session || !event || typeof event.type !== 'string') return
      const entry = bySession.get(session)
      if (!entry) return
      const state = entry.state
      if (event.type === 'turn/start') {
        const data = event.data || {}
        advance(entry, (next) => {
          next.turn = typeof data.turn === 'number' ? data.turn : next.turn
          next.step = 1
          next.active = true
          next.stamped = false
        })
      } else if (event.type === 'step/end') {
        if (!state.active) return
        const data = event.data || {}
        advance(entry, (next) => {
          const step = typeof data.step === 'number' ? data.step : next.step
          next.step = step + 1
        })
      } else if (event.type === 'turn/end') {
        const restore = state.restore
        const restoreFrom = state.restoreFrom
        advance(entry, (next) => {
          next.active = false
          next.step = 0
        })
        restoreDurable(entry, restore, restoreFrom)
      }
    },

    dispose() {
      disposed = true
      for (const entry of installed) {
        try {
          if (entry.agent && entry.agent.model && entry.agent.model.current === entry.wrapper) {
            entry.agent.model.current = entry.native
          }
        } catch (_ignore) { /* readonly model */ }
      }
      installed.length = 0
    },
  }
}
