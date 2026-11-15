/**
 * Whole-turn Auto scheduler for the 0.2.2 agent loop (F-01 / F-02).
 *
 * Why this module exists
 * ----------------------
 * 0.2.1 let a plugin rewrite `reasoningEffort` inside the `agent/request`
 * waterfall. 0.2.2 fixed that hole shut: the step's model selection is
 * captured once, BEFORE `agent/pre-step`, and `agent/request` is only allowed
 * to return that exact selection (provider, model, reasoningEffort). A later
 * edit is rejected with "use agent.model.select() before step preparation".
 *
 * So the only legal seam is the session's own durable selection:
 *
 *   agent/inbox/claimed   (synchronous, before the capture)
 *     → schedule the FIRST step of the turn and `agent.model.select(...)`
 *   step/end
 *     → preselect the NEXT step (the turn continues; captures happen per step)
 *   turn/end
 *     → restore the durable Auto intent (`reasoningEffort: 'auto'`) so the
 *       next turn starts from Auto again — but only when nothing else has
 *       changed the selection since our last write.
 *
 * Everything here is deliberately synchronous: the host fires `session/event`
 * while appending `step/end`, and the next capture may follow immediately.
 * Capability data is read from the resolver's synchronous cache
 * (`peek`), never awaited inside `claimed`; a synchronous miss degrades to a
 * safe omission (no effort field) instead of a guessed level.
 *
 * Guards:
 *   - one state per SESSION OBJECT (a re-created agent/session generation with
 *     the same id gets its own state, so a stale completion can never write
 *     into the replacement);
 *   - `disposed` short-circuits every hook;
 *   - no `model.select` → fail closed in `agent/pre-step` (F01-17), never a
 *     fallback to the forbidden request rewrite;
 *   - restoration is skipped when the current selection differs from our last
 *     write (the user took over mid-turn).
 */

const normalizeSelection = (selection) => {
  if (!selection || typeof selection !== 'object') return null
  const provider = typeof selection.provider === 'string' ? selection.provider : undefined
  const model = typeof selection.model === 'string' ? selection.model : undefined
  if (!provider || !model) return null
  const effort = typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined
  return effort === undefined ? { provider, model } : { provider, model, reasoningEffort: effort }
}

const sameSelection = (left, right) => {
  const a = normalizeSelection(left)
  const b = normalizeSelection(right)
  if (!a || !b) return false
  return a.provider === b.provider
    && a.model === b.model
    && a.reasoningEffort === b.reasoningEffort
}

/**
 * @param {object} options
 * @param {(agent, payload, phase, state) => ({write?: object, restore?: object|'auto', requiresWrite?: boolean, failClosed?: boolean}|null)} options.plan
 *        Decision callback owned by the plugin (index.js). `write: undefined`
 *        means "do not touch the selection"; an object without
 *        `reasoningEffort` is the safe omission.
 * @param {(provider: string, model: string) => Promise<unknown>} [options.resolveCapability]
 *        Public capability resolver; called fire-and-forget from pre-step so the
 *        NEXT claim can peek a resolved entry.
 * @param {() => boolean} [options.isDisposed]
 */
export function createTurnAuto(options) {
  const plan = typeof options.plan === 'function' ? options.plan : () => null
  const resolveCapability = typeof options.resolveCapability === 'function' ? options.resolveCapability : null
  const isDisposed = typeof options.isDisposed === 'function' ? options.isDisposed : () => false

  /** session OBJECT -> state (identity, not id: branch generations share ids). */
  const states = new WeakMap()
  let closed = false

  const dead = () => closed || isDisposed() === true

  const currentOf = (agent) => {
    try {
      return agent && agent.model && typeof agent.model.current === 'function'
        ? normalizeSelection(agent.model.current())
        : null
    } catch (_unreadable) {
      return null
    }
  }

  const ensure = (agent) => {
    const session = agent && agent.session && typeof agent.session === 'object' ? agent.session : null
    if (!session) return null
    let state = states.get(session)
    if (!state) {
      state = {
        agent,
        session,
        /** Durable selection to restore at turn end: 'auto' or an object. */
        restore: null,
        /** Exact selection this module last wrote, for the takeover guard. */
        lastWrite: null,
        route: null,
        /** True when a required write was impossible (no model.select). */
        failClosed: false,
      }
      states.set(session, state)
    } else if (state.agent !== agent) {
      state.agent = agent
    }
    return state
  }

  const writeSelection = (state, selection) => {
    const agent = state.agent
    const model = agent && agent.model
    if (!model || typeof model.select !== 'function') return 'missing'
    const normalized = normalizeSelection(selection)
    if (!normalized) return 'missing'
    try {
      model.select(normalized)
    } catch (_rejected) {
      // 0.2.2 publishes `step/end` from inside `session.append`, and a session
      // may not append again while that publish is still running. The write is
      // legal one tick later, so remember it and retry outside the publish
      // instead of failing the step shut.
      return 'threw'
    }
    state.lastWrite = normalized
    state.route = { provider: normalized.provider, model: normalized.model }
    return 'written'
  }

  const takeover = (state) => {
    // The user picked something else after our last write: their intent wins.
    const current = currentOf(state.agent)
    if (!state.lastWrite) return current !== null
    return !sameSelection(current, state.lastWrite)
  }

  const retryPending = (state) => {
    if (dead() || !state.pendingWrite) return
    const target = state.pendingWrite
    if (takeover(state)) {
      state.pendingWrite = null
      return
    }
    const result = writeSelection(state, target)
    if (result !== 'threw') state.pendingWrite = null
  }

  const queueRetry = (state) => {
    if (typeof queueMicrotask !== 'function') return
    queueMicrotask(() => retryPending(state))
  }

  const applyPlan = (state, outcome, { allowRestore = true } = {}) => {
    if (!outcome || typeof outcome !== 'object') return
    if (outcome.failClosed === true) state.failClosed = true
    if (outcome.write !== undefined) {
      const written = writeSelection(state, outcome.write)
      if (written === 'missing') {
        if (outcome.requiresWrite === true) state.failClosed = true
        return
      }
      if (written === 'threw') {
        state.pendingWrite = normalizeSelection(outcome.write)
        queueRetry(state)
        return
      }
    }
    if (allowRestore && outcome.restore !== undefined) state.restore = outcome.restore
  }

  const primeCapability = (agent) => {
    if (!resolveCapability) return
    const route = currentOf(agent)
    if (!route) return
    try {
      const pending = resolveCapability(route.provider, route.model)
      if (pending && typeof pending.catch === 'function') pending.catch(() => {})
    } catch (_unavailable) { /* capability is advisory; the request still runs */ }
  }

  return {
    /** `agent/inbox/claimed` — synchronous, before the host captures selection. */
    claimed(payload) {
      if (dead()) return
      const agent = payload && payload.agent
      const state = ensure(agent)
      if (!state) return
      retryPending(state)
      const outcome = plan(agent, payload, 'claim', state)
      if (outcome) applyPlan(state, outcome)
    },

    /** `agent/pre-step` waterfall — the last point before capture is enforced. */
    preStep(event, next) {
      if (dead()) return typeof next === 'function' ? next() : undefined
      const agent = event && event.agent
      const state = ensure(agent)
      if (state) primeCapability(agent)
      if (state) retryPending(state)
      if (state && state.failClosed) {
        return {
          kind: 'reject',
          reason: 'effort-router: this host requires agent.model.select() to fix the step'
            + ' selection, but the session model exposes no select(); refusing to fall back to the'
            + ' 0.2.1 agent/request rewrite (0.2.2 rejects it)',
        }
      }
      const captured = normalizeSelection(event && event.modelSelection)
      if (captured && captured.reasoningEffort === 'auto') {
        // Nothing resolved the selector sentinel before the host captured it.
        // Sending 'auto' onward is invalid; fail loudly instead of guessing.
        return {
          kind: 'reject',
          reason: 'effort-router: the step selection is still the unresolved Auto sentinel;'
            + ' no synchronous agent.model.select() ran before step preparation',
        }
      }
      return typeof next === 'function' ? next() : undefined
    },

    /** `session/event` — step/end preselection and turn/end restoration. */
    sessionEvent(session, event) {
      if (dead()) return
      if (!session || !event || typeof event.type !== 'string') return
      const state = states.get(session)
      if (!state) return
      if (event.type === 'step/end') {
        // Only a logical-Auto turn keeps scheduling: manual picks, pinned
        // defaults and fixed subagent levels must stay untouched.
        if (state.restore !== 'auto') return
        const data = event.data && typeof event.data === 'object' ? event.data : {}
        const outcome = plan(state.agent, { turn: data.turn, step: data.step }, 'continue', state)
        if (!outcome || outcome.write === undefined) return
        applyPlan(state, outcome, { allowRestore: false })
        return
      }
      if (event.type === 'turn/end') {
        const restore = state.restore
        state.restore = null
        if (!restore) {
          states.delete(session)
          return
        }
        const target = restore === 'auto'
          ? (state.route
            ? { provider: state.route.provider, model: state.route.model, reasoningEffort: 'auto' }
            : null)
          : normalizeSelection(restore)
        // Takeover guard: the user changed the selection after our write, so
        // the turn ended on their intent, not ours.
        if (target && sameSelection(currentOf(state.agent), state.lastWrite)) {
          const written = writeSelection(state, target)
          if (written === 'threw') {
            state.pendingWrite = normalizeSelection(target)
            queueRetry(state)
          }
        }
        states.delete(session)
      }
    },

    /** Stop reacting: the owning effect already removed the listeners. */
    dispose() {
      closed = true
    },
  }
}
