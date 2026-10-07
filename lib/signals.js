/**
 * dsh-effort-router — per-agent signal collection (import-free; services injected).
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/index.js (MIT,
 * Copyright Neptune810) — the half of its host side that reads the session:
 *
 *   - user brief text accumulates from `agent/inbox/claimed` (per turn), with a
 *     `deriveMessages()` last-user-text fallback for resumed windows;
 *   - tool evidence folds INCREMENTALLY out of `agent.session.deriveMessages()`
 *     behind a `seenMessages` watermark (taskToolCalls / taskErrors /
 *     taskRepeats / poisonedHistory);
 *   - optional `sessionProjections` reads sharpen the decision (todos,
 *     contextPressure, tokenUsage); `session.header.delegationDepth` marks
 *     subagents.
 *
 * Two hard-won design rules (see the dsh-thinking-levels postmortem):
 *   1. NEVER read `session.events` — that property does not exist on DSH 0.2
 *      Sessions; reading it degrades every schedule to the empty-sample branch
 *      SILENTLY. This module reads deriveMessages() only.
 *   2. Degradation must be LOUD: a missing deriveMessages or an empty
 *      projection in a session that has claimed text warns once per agent, so
 *      a broken host surface is visible in the log instead of silently
 *      collapsing every decision to "low".
 */

import {
  contentHasImage,
  textOfContent,
  toolCallWithoutReasoning,
  toolCallsOf,
  toolErrorsOf,
} from './policy.js'
import {
  activeTodoText,
  contextPressureRatio,
  sessionTokensOf,
  stabilize,
} from './routing.js'

/** Plain text of one claimed user message (content may be blocks or a string). */
function claimedText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    const text = textOfContent(message.content)
    return contentHasImage(message.content) ? text + ' [image attached]' : text
  }
  return ''
}

/** Last user message text, as a fallback when no claim was observed yet. */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg) continue
    const role = typeof msg.role === 'string' ? msg.role : msg.type
    if (role === 'user') {
      if (Array.isArray(msg.content)) {
        const text = textOfContent(msg.content)
        if (text.trim()) return text
      } else if (typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content
      }
    }
    if (i < Math.max(0, messages.length - 8)) break
  }
  return ''
}

/** Does the whole projection already contain a tool call with no thinking? */
function poisonedIn(messages) {
  for (const msg of messages) {
    if (!msg || !Array.isArray(msg.content)) continue
    const role = typeof msg.role === 'string' ? msg.role : msg.type
    if (role === 'assistant' && toolCallWithoutReasoning(msg.content)) return true
  }
  return false
}

/**
 * Create the signal collector.
 *
 * @param opts.config   () => live normalized runtime config (volatile-safe getter)
 * @param opts.logger   host logger ({ info, warn })
 * @param opts.projections  the optional sessionProjections service, or undefined
 */
export function createSignals(opts) {
  const configOf = opts && typeof opts.config === 'function' ? opts.config : () => ({})
  const logger = (opts && opts.logger) || console
  const projections = opts && opts.projections

  /** Per-agent state. One entry per live agent; nothing is shared. */
  const states = new WeakMap()

  function stateOf(agent) {
    let state = states.get(agent)
    if (state !== undefined) return state
    state = {
      claimed: new Map(),
      lastTurn: -1,
      seenMessages: 0,
      taskOpen: false,
      taskToolCalls: 0,
      taskErrors: 0,
      taskRepeats: 0,
      seenCalls: new Map(),
      hasImage: false,
      carry: 0,
      poisonedHistory: false,
      /** Effort hysteresis memory: { value, streak }. */
      hysteresis: { value: undefined, streak: 0 },
      warned: Object.create(null),
    }
    states.set(agent, state)
    return state
  }

  function warnOnce(state, key, message) {
    if (state.warned[key]) return
    state.warned[key] = true
    logger.warn('[effort-router] ' + message)
  }

  /** Collect messages through the session projection (never the raw log). */
  function messagesOf(agent, state) {
    try {
      const session = agent && agent.session
      if (session && typeof session.deriveMessages === 'function') {
        return session.deriveMessages()
      }
      state.noApi = true
      warnOnce(
        state,
        'api',
        'session.deriveMessages is not a function on this host; '
        + 'effort scheduling degrades to brief-only classification. '
        + 'Check the plugin against this DSH version.',
      )
    } catch (error) {
      warnOnce(state, 'api-throw', 'deriveMessages failed: ' + String((error && error.message) || error))
    }
    return []
  }

  /**
   * Fold newly appended messages into the current task's evidence counters.
   * Tool results are user-role messages carrying { type: "tool-result" } blocks.
   */
  function scanFresh(state, messages) {
    if (messages.length < state.seenMessages) {
      // The projection shrank (compaction, branch switch): resync, and re-derive
      // the continuity flag because the poisoned turn may be gone.
      state.seenMessages = messages.length
      state.poisonedHistory = poisonedIn(messages)
      return
    }
    if (messages.length === state.seenMessages) return
    const fresh = messages.slice(state.seenMessages)
    state.seenMessages = messages.length
    for (const msg of fresh) {
      const content = msg && Array.isArray(msg.content) ? msg.content : null
      if (!content) continue
      const role = typeof msg.role === 'string' ? msg.role : msg.type
      if (role === 'assistant') {
        if (toolCallWithoutReasoning(content)) state.poisonedHistory = true
        for (const call of toolCallsOf(content)) {
          state.taskToolCalls += 1
          const seen = state.seenCalls.get(call.key) || 0
          state.seenCalls.set(call.key, seen + 1)
          if (seen >= 1) state.taskRepeats += 1
        }
      } else if (role === 'user') {
        state.taskErrors += toolErrorsOf(content)
        if (contentHasImage(content)) state.hasImage = true
      }
    }
  }

  /** Keep the claimed-text map bounded over long sessions. */
  function prune(state, turn) {
    for (const key of state.claimed.keys()) {
      if (key < turn - 4) state.claimed.delete(key)
    }
  }

  /**
   * A claimed user message opens a new task: retire evidence, reset hysteresis,
   * and carry one hesitant step up when the previous task ended on an
   * unresolved failure.
   */
  function onClaimed(payload) {
    const agent = payload && payload.agent
    const message = payload && payload.message
    if (!agent || !message) return
    const text = claimedText(message)
    if (!text) return
    const cfg = configOf()
    const state = stateOf(agent)
    const turn = typeof payload.turn === 'number' ? payload.turn : state.lastTurn

    if (state.taskOpen) {
      state.carry = cfg.carryUnresolved !== false && state.taskErrors > 0 ? 1 : 0
    }
    state.taskOpen = true
    state.taskToolCalls = 0
    state.taskErrors = 0
    state.taskRepeats = 0
    state.seenCalls = new Map()
    state.hasImage = false
    // Hysteresis dampens flapping inside one task; a new command is a new call.
    state.hysteresis = { value: undefined, streak: 0 }
    state.claimed.set(turn, (state.claimed.get(turn) || '') + '\n' + text)
    if (turn > state.lastTurn) state.lastTurn = turn
    prune(state, turn)
  }

  /** How many classes of escalation the current task's evidence has earned. */
  function escalationsFor(state, cfg) {
    let n = 0
    const onErrors = Math.max(1, Number(cfg.escalateOnErrors) || 2)
    const onRepeats = Math.max(2, Number(cfg.escalateOnRepeats) || 3)
    if (state.taskErrors >= onErrors) n = Math.max(n, 1)
    if (state.taskErrors >= onErrors * 2) n = Math.max(n, 2)
    if (state.taskRepeats >= onRepeats) n = Math.max(n, 1)
    return Math.min(Math.max(1, Number(cfg.maxEscalations) || 2), n)
  }

  /** Session-header facts readable without a service. */
  function depthOf(agent) {
    const header = agent && agent.session && agent.session.header
    if (header && Number.isFinite(header.delegationDepth)) return header.delegationDepth
    if (agent && agent.parentAgent !== undefined) return 1
    return 0
  }

  /**
   * Optional session projections that sharpen the decision. Every read is
   * advisory — a missing service or an unreadable unit degrades to "no signal".
   */
  function projectionSignals(agent, cfg) {
    const out = {
      todoText: '',
      pressure: null,
      sessionTokens: 0,
      delegationDepth: depthOf(agent),
      frugal: false,
      frugalWhy: '',
    }
    if (projections && typeof projections.stateOf === 'function' && agent && agent.session) {
      const read = (key) => { try { return projections.stateOf(agent.session, key) } catch (_unreadable) { return undefined } }
      if (cfg.todosSignal !== false) out.todoText = activeTodoText(read('todos'))
      out.pressure = contextPressureRatio(read('contextPressure'))
      out.sessionTokens = sessionTokensOf(read('tokenUsage'))
    }
    if (cfg.subagentPreferCheap !== false && out.delegationDepth > 0) {
      out.frugal = true
      out.frugalWhy = 'subagent'
    }
    const threshold = Number(cfg.contextPressure)
    if (threshold > 0 && out.pressure !== null && out.pressure >= threshold) {
      out.frugal = true
      out.frugalWhy = 'context pressure ' + Math.round(out.pressure * 100) + '%'
    }
    const budget = Number(cfg.sessionTokenBudget)
    if (budget > 0 && out.sessionTokens >= budget) {
      out.frugal = true
      out.frugalWhy = 'session token budget'
    }
    return out
  }

  /** Signals for the current step, computed from claims + session projection. */
  function collect(agent, payload) {
    const cfg = configOf()
    const state = stateOf(agent)
    const messages = messagesOf(agent, state)
    const turn = typeof (payload && payload.turn) === 'number' ? payload.turn : state.lastTurn
    scanFresh(state, messages)
    if (turn > state.lastTurn) state.lastTurn = turn

    // Loud degradation: claims exist but the projection shows nothing at all
    // (only meaningful when the projection API itself is present).
    if (!state.noApi && messages.length === 0 && state.claimed.size > 0) {
      warnOnce(
        state,
        'empty',
        'deriveMessages() returned an empty projection although this session has claimed prompts; '
        + 'classification runs on the brief alone. Check the plugin against this DSH version.',
      )
    }

    let text = state.claimed.get(turn)
    if (text === undefined) {
      // Claim events may not cover resumed windows; fall back to the projection.
      text = lastUserText(messages)
    }
    const base = {
      text: text || '',
      turn,
      toolCalls: state.taskToolCalls,
      // The raw evidence counters, exposed for the decision log and the badge.
      taskErrors: state.taskErrors,
      taskRepeats: state.taskRepeats,
      hasImage: state.hasImage || /\[image attached\]/.test(text || ''),
      escalations: escalationsFor(state, cfg),
      carry: state.carry,
      poisonedHistory: state.poisonedHistory,
    }
    const projected = projectionSignals(agent, cfg)
    // The active todo is part of the brief: it states what this step really is.
    const brief = projected.todoText ? base.text + '\n' + projected.todoText : base.text
    return { ...base, ...projected, text: brief, rawText: base.text }
  }

  /**
   * Apply effort hysteresis against this agent's memory. Returns the stabilized
   * tier plus whether the desired tier was held back.
   */
  function stabilizeEffort(agent, tier, downAfter) {
    const state = stateOf(agent)
    const next = stabilize(tier, state.hysteresis.value, state.hysteresis.streak, downAfter)
    state.hysteresis = next
    return { tier: next.value, held: next.value !== tier }
  }

  return { collect, onClaimed, stabilizeEffort, stateOf }
}
