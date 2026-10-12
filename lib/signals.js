/**
 * dsh-effort-router — per-agent signal collection (import-free; services injected).
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/index.js (MIT,
 * Copyright Neptune810) — the half of its host side that reads the session:
 *
 *   - user brief text accumulates from `agent/inbox/claimed` (per turn), with a
 *     `deriveMessages()` last-user-text fallback for resumed windows;
 *   - tool evidence folds INCREMENTALLY out of `agent.session.deriveMessages()`
 *     behind a `seenMessages` watermark into a SLIDING WINDOW of the last
 *     `scoring.toolWindow` (default 32) step buckets. One bucket ≈ one step's
 *     tool batch: an assistant message's calls open it, the following user
 *     tool-result message folds errors/result-volume and seals it. Errors,
 *     identical-argument repeats, and result volume all read from the same
 *     window, so stale evidence ages out of long tasks;
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
  textOfContent,
  tokenEstimate,
  toolCallWithoutReasoning,
  toolCallsOf,
  toolErrorOfMessage,
  toolErrorsOf,
  evidenceBumps,
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
  if (Array.isArray(message.content)) return textOfContent(message.content)
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

/** Does the whole projection contain a tool call with no thinking block?
 *  SHAPE FACT ONLY: this says nothing about whether thinking was off — models
 *  like kimi-K3 emit no reasoning block before tool calls with thinking ON
 *  (measured 2026-10-10, session eb12fb23: K3 @ low produced reasoning blocks
 *  on steps 1/3 but none on the tool-call step 2 of the same turn). The host
 *  combines this shape with decision-store provenance before pinning off. */
function offShapeIn(messages) {
  for (const msg of messages) {
    if (!msg || !Array.isArray(msg.content)) continue
    const role = typeof msg.role === 'string' ? msg.role : msg.type
    if (role === 'assistant' && toolCallWithoutReasoning(msg.content)) return true
  }
  return false
}

/** A fresh, empty step bucket. */
function newBucket() {
  return { calls: [], errors: 0, repeats: 0, volume: 0 }
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
      carry: 0,
      offShapeHistory: false,
      /**
       * Sliding evidence window: sealed step buckets (oldest first) plus one
       * open `pending` bucket. `seen` counts call keys across ring+pending
       * for identical-argument repeat detection.
       */
      ring: [],
      pending: null,
      seen: new Map(),
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

  /** Seal a bucket into the ring and evict the oldest beyond the window. */
  function seal(state, bucket, windowSize) {
    state.ring.push(bucket)
    while (state.ring.length > windowSize) {
      const old = state.ring.shift()
      for (const key of old.calls) {
        const n = (state.seen.get(key) || 0) - 1
        if (n <= 0) state.seen.delete(key)
        else state.seen.set(key, n)
      }
    }
  }

  /**
   * Fold newly appended messages into the sliding window.
   * Tool results arrive in two shapes:
   *   - v4 (current DSH): first-class `role: "tool"` messages — isError at
   *     message level, plain text blocks (audit R1: the 0.2.x collector only
   *     read the v0/v3 shape, so on v4 the window's errors and volume were
   *     stuck at 0 and escalateOnErrors / the volume ladders never fired);
   *   - v0/v3 (replayed logs): user-role messages carrying
   *     { type: "tool-result" } blocks.
   * The shapes are mutually exclusive per session in the 200k-event audit
   * corpus, and the seenMessages watermark scans each message exactly once,
   * so no per-callId dedupe table is kept; the id fields (msg.toolCallId /
   * msg.source.callId) are in place if a mixed-shape history ever appears.
   */
  function scanFresh(state, messages) {
    if (messages.length < state.seenMessages) {
      // The projection shrank (compaction, branch switch): resync, and re-derive
      // the shape flag because the offending turn may be gone.
      state.seenMessages = messages.length
      state.offShapeHistory = offShapeIn(messages)
      return
    }
    if (messages.length === state.seenMessages) return
    const cfg = configOf()
    const windowSize = Math.max(1, Number(cfg && cfg.scoring && cfg.scoring.toolWindow) || 32)
    const fresh = messages.slice(state.seenMessages)
    state.seenMessages = messages.length
    for (const msg of fresh) {
      if (!msg) continue
      const role = typeof msg.role === 'string' ? msg.role : msg.type
      if (role === 'assistant') {
        const content = Array.isArray(msg.content) ? msg.content : null
        if (!content) continue
        if (toolCallWithoutReasoning(content)) state.offShapeHistory = true
        const calls = toolCallsOf(content)
        if (calls.length === 0) continue
        // A new step's calls: seal the previous open bucket first (its
        // results either already folded or never arrived).
        if (state.pending && state.pending.calls.length > 0) {
          seal(state, state.pending, windowSize)
          state.pending = null
        }
        if (!state.pending) state.pending = newBucket()
        for (const call of calls) {
          const n = state.seen.get(call.key) || 0
          state.seen.set(call.key, n + 1)
          state.pending.calls.push(call.key)
          if (n >= 1) state.pending.repeats += 1
        }
      } else if (role === 'tool') {
        // v4: fold message-level error evidence + result volume, seal the step.
        const bucket = state.pending ?? newBucket()
        bucket.errors += toolErrorOfMessage(msg)
        bucket.volume += tokenEstimate(textOfContent(msg.content))
        seal(state, bucket, windowSize)
        state.pending = null
      } else if (role === 'user') {
        const content = Array.isArray(msg.content) ? msg.content : null
        if (!content) continue
        const errors = toolErrorsOf(content)
        const hasResults = content.some((part) => part && part.type === 'tool-result')
        if (!hasResults) continue
        const bucket = state.pending ?? newBucket()
        bucket.errors += errors
        bucket.volume += tokenEstimate(textOfContent(content))
        seal(state, bucket, windowSize)
        state.pending = null
      }
    }
  }

  /** Window sums over sealed buckets plus the open one. */
  function windowSums(state) {
    let errors = 0
    let repeats = 0
    let volume = 0
    let toolCalls = 0
    // Trailing run of identical tool names across the window. OBSERVATION
    // ONLY (audit R4.3): recorded in the decision log so a future version can
    // judge whether "stuck on one tool" deserves its own escalation; it does
    // not enter any decision now.
    let consecSameTool = 0
    let lastName = null
    const walk = (bucket) => {
      errors += bucket.errors
      repeats += bucket.repeats
      volume += bucket.volume
      toolCalls += bucket.calls.length
      for (const key of bucket.calls) {
        const bar = key.indexOf('|')
        const name = bar < 0 ? key : key.slice(0, bar)
        if (name === lastName) consecSameTool += 1
        else {
          lastName = name
          consecSameTool = 1
        }
      }
    }
    for (const bucket of state.ring) walk(bucket)
    if (state.pending) walk(state.pending)
    return { errors, repeats, volume, toolCalls, consecSameTool }
  }

  /** Keep the claimed-text map bounded over long sessions. */
  function prune(state, turn) {
    for (const key of state.claimed.keys()) {
      if (key < turn - 4) state.claimed.delete(key)
    }
  }

  /**
   * A claimed user message opens a new task: retire the evidence window, reset
   * hysteresis, and carry one hesitant step up when the previous task ended on
   * an unresolved failure.
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
      state.carry = cfg.carryUnresolved !== false && windowSums(state).errors > 0 ? 1 : 0
    }
    state.taskOpen = true
    state.ring = []
    state.pending = null
    state.seen = new Map()
    // Hysteresis dampens flapping inside one task; a new command is a new call.
    state.hysteresis = { value: undefined, streak: 0 }
    state.claimed.set(turn, (state.claimed.get(turn) || '') + '\n' + text)
    if (turn > state.lastTurn) state.lastTurn = turn
    prune(state, turn)
  }

  /** Session-header facts readable without a service. */
  function depthOf(agent) {
    const header = agent && agent.session && agent.session.header
    if (header && Number.isFinite(header.delegationDepth)) return header.delegationDepth
    if (agent && agent.parentAgent != null) return 1
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
    const window = windowSums(state)
    const projected = projectionSignals(agent, cfg)
    // The active todo is part of the brief: it states what this step really is.
    const brief = projected.todoText ? (text || '') + '\n' + projected.todoText : (text || '')
    return {
      text: brief,
      turn,
      toolCalls: window.toolCalls,
      // Raw window counters, exposed for the decision log and the badge.
      taskErrors: window.errors,
      taskRepeats: window.repeats,
      /** Trailing identical-tool run (observation only, audit R4.3). */
      consecSameTool: window.consecSameTool,
      /** Volume cues (0.2.0): assembled-brief tokens and window result tokens. */
      briefTokens: tokenEstimate(brief),
      toolVolume: window.volume,
      escalations: evidenceBumps(window.errors, window.repeats, cfg),
      carry: state.carry,
      /** Shape fact: a reasoning-less tool-call turn exists in history. The
       *  host decides whether it is POISON (provenance-gated); never read this
       *  as "thinking was off" on its own. */
      offShapeHistory: state.offShapeHistory,
      ...projected,
    }
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
