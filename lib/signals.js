/**
 * dsh-effort-router — per-agent signal collection for the drift engine
 * (import-free; services injected).
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/index.js (MIT,
 * Copyright Neptune810) — the half of its host side that reads the session.
 * 0.2.8 re-architected it around the drift channels:
 *
 *   - CHANNEL ④ ORIGIN: a claimed user message opens a task and classifies
 *     ONCE (policy.classifyStep on the brief alone — todo text is no longer
 *     evidence, it is only a rearrangement of that brief). Interjections
 *     and question answers are user messages too, so they open a task as
 *     well — UNLESS they land inside the previous task's warm-up window
 *     (default 3 steps), in which case the STRONGER origin wins and the
 *     warm-up restarts. Tasks also open synthetically when the projection
 *     shows a plain user text the claim stream never announced (resumed
 *     windows, hosts that do not emit claimed for interjections).
 *   - CHANNEL ① SHORT window (default 6 tool batches, decay-weighted):
 *     tool errors and identical-argument repeats fold out of
 *     deriveMessages() behind a watermark into sealed step buckets; the
 *     per-bucket weight comes from cfg.errorDecay (newest first). Event
 *     bumps, each +1 while inside the window and firing once per step no
 *     matter how many landed: a todo completion (status transition in the
 *     todos projection), a subagent/workflow RETURN (0.2.9 — a sealed
 *     bucket whose calls included subagent/subagent_fork/workflow: the
 *     parent must now integrate the result), and a compaction CHECKPOINT
 *     (0.2.9 — the working map was just lossy-replaced: peak fidelity
 *     risk). A task that ended on an unresolved error carries +1 into the
 *     next task's window.
 *   - CHANNEL ② LONG window (default 32 tool batches): brief tokens and
 *     tool-result tokens summed as gzip-discounted EFFECTIVE tokens
 *     (repetition is not information; see lib/compress.js). The long
 *     window spans task boundaries — context pressure does not reset when
 *     the user sends a new command.
 *   - CHANNEL ③ REAL-TIME: frugal signals from the projections
 *     (contextPressure, tokenUsage) and the session header
 *     (delegationDepth).
 *
 * Two hard-won design rules (see the dsh-thinking-levels postmortem):
 *   1. NEVER read `session.events` — that property does not exist on DSH 0.2
 *      Sessions; reading it degrades every schedule to the empty-sample branch
 *      SILENTLY. This module reads deriveMessages() for message evidence.
 *      The ONE exception (0.2.9): the compaction checkpoint scan reads
 *      `session.snapshotEvents?.()` — the guarded, host-contracted accessor
 *      (verified in app.asar dsh-api-session-controller/lib/types/history.js
 *      and used the same way by the ACP plugin) — never `session.events`,
 *      and always behind typeof checks, degrading to "no signal" silently
 *      (a bonus channel, unlike the message evidence below).
 *   2. Degradation must be LOUD: a missing deriveMessages or an empty
 *      projection in a session that has claimed text warns once per agent, so
 *      a broken host surface is visible in the log instead of silently
 *      collapsing every decision to "low".
 */

import {
  classifyStep,
  textOfContent,
  foldVolume,
  toolCallWithoutReasoning,
  toolCallsOf,
  toolErrorOfMessage,
  toolErrorsOf,
} from './policy.js'
import {
  contextPressureRatio,
  sessionTokensOf,
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

/** A fresh, empty step bucket. `epoch` scopes it to one task (channel ①). */
function newBucket(tick, epoch) {
  return { calls: [], errors: 0, repeats: 0, volume: 0, effective: 0, tick, epoch }
}

const CLASS_RANK = { trivial: 0, standard: 1, engineering: 2, hard: 3 }

/**
 * Tools whose RESULT means "an orchestration step returned; the parent
 * must integrate it" (0.2.9 channel-① event). Foreground runs land as the
 * call's own tool result; background settle notifications that arrive as
 * the original call's tool result are covered by the same fold.
 */
const SUBAGENT_TOOLS = new Set(['subagent', 'subagent_fork', 'workflow'])

/** Does a sealed bucket's call list contain an orchestration tool? */
function hasSubagentCall(bucket) {
  for (const key of bucket.calls) {
    const bar = key.indexOf('|')
    if (SUBAGENT_TOOLS.has(bar < 0 ? key : key.slice(0, bar))) return true
  }
  return false
}

/**
 * Engine-agnostic compaction checkpoint test over session EVENTS
 * (verified against app.asar @deepseek-ai/dsh-compaction and the ACP
 * engine, which both land checkpoints through the same primitives):
 * a user/message event whose source marks it as a compaction checkpoint,
 * or a compaction/end lifecycle event.
 */
function isCompactionEvent(event) {
  if (!event || typeof event.type !== 'string') return false
  if (event.type === 'compaction/end') return true
  if (event.type !== 'user/message') return false
  const source = event.data && event.data.source
  return !!source && (source.plugin === 'compact' || source.kind === 'compact-checkpoint')
}

/**
 * Create the signal collector.
 *
 * @param opts.config   () => live normalized runtime config (volatile-safe getter)
 * @param opts.logger   host logger ({ info, warn })
 * @param opts.projections  the optional sessionProjections service, or undefined
 * @param opts.compress     optional { ratio(pieces) } from lib/compress.js;
 *                          absent = no discount (raw tokens, pre-0.2.8 behavior)
 */
export function createSignals(opts) {
  const configOf = opts && typeof opts.config === 'function' ? opts.config : () => ({})
  const logger = (opts && opts.logger) || console
  const projections = opts && opts.projections
  const compress = opts && opts.compress

  /** Per-agent state. One entry per live agent; nothing is shared. */
  const states = new WeakMap()

  function stateOf(agent) {
    let state = states.get(agent)
    if (state !== undefined) return state
    state = {
      claimed: new Map(),
      lastTurn: -1,
      seenMessages: 0,
      /** Step counter: one collect() = one step; window ages are measured in it. */
      tick: 0,
      /** Channel ④ origin anchor of the open task. */
      taskOpen: false,
      claimTick: -1,
      origin: { cls: 'standard', reason: [] },
      /**
       * Task epoch: increments on every REAL task boundary. The short
       * window reads only current-epoch buckets (a new task starts from
       * zero error evidence; `carry` is the cross-task channel), while the
       * long volume window spans epochs — context pressure does not reset
       * when the user sends a new command.
       */
      epoch: 0,
      /** Channel ① carry (+1 while inside the short window of the new task). */
      carry: 0,
      carryTick: -1,
      /** Ticks at which a todo completion bump fired (short-window decay). */
      todoEvents: [],
      /** Ticks at which a subagent/workflow result landed (short-window decay). */
      subagentEvents: [],
      /** Ticks at which a compaction checkpoint landed (NOT epoch-cleared). */
      compactionEvents: [],
      /** Watermark into session.snapshotEvents() for the compaction scan. */
      eventWatermark: 0,
      /** Previous todos projection snapshot (content -> status). */
      prevTodos: null,
      offShapeHistory: false,
      /**
       * Evidence ring: sealed step buckets (oldest first, capped at
       * longWindow) plus one open `pending` bucket. The SHORT window reads
       * the newest shortWindow buckets with decay weights; the LONG window
       * reads the whole ring. `seen` counts call keys across ring+pending
       * for identical-argument repeat detection.
       */
      ring: [],
      pending: null,
      seen: new Map(),
      /** Channel ② brief entries: { tick, tokens, effective }. */
      briefs: [],
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

  function warmUpSteps(cfg) {
    const n = Number(cfg && cfg.warmUpSteps)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3
  }

  function shortWindowOf(cfg) {
    const n = Number(cfg && cfg.shortWindow)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 6
  }

  function longWindowOf(cfg) {
    const n = Number(cfg && cfg.longWindow)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 32
  }

  /** gzip-discounted effective tokens of one volume fold. */
  function effectiveOf(cfg, fold) {
    if (!compress || cfg.compressDiscount === false) return fold.tokens
    const measured = compress.ratio(fold.pieces)
    if (!measured) return fold.tokens
    return Math.round(fold.tokens * measured.ratio)
  }

  /**
   * Open a task: classify the origin ONCE, apply the warm-up merge rule,
   * and (on a real boundary) carry an unresolved failure into the new
   * task's short window. Merged continuations (a follow-up inside the
   * warm-up) keep the stronger origin and restart the warm-up — they are
   * the same task.
   */
  function openTask(state, cfg, text, turn) {
    const merged = state.taskOpen
      && state.claimTick >= 0
      && state.tick - state.claimTick <= warmUpSteps(cfg)
    if (state.taskOpen && !merged) {
      // Carry reads the PREVIOUS epoch's short window, then the epoch
      // flips: the new task's error evidence starts from zero.
      state.carry = cfg.carryUnresolved !== false && shortSums(state, cfg).errors > 0 ? 1 : 0
      state.carryTick = state.tick
      state.todoEvents = []
      state.subagentEvents = []
      // compactionEvents is NOT cleared: the lossy map is still the map
      // after a task boundary (the risk is context-bound, not task-bound).
      state.epoch += 1
      // An open bucket belongs to the previous task: seal it into the old
      // epoch so its evidence cannot leak into the new task's window.
      if (state.pending) {
        seal(state, state.pending, longWindowOf(cfg))
        state.pending = null
      }
    }
    if (text) {
      const next = classifyStep({ text }, cfg)
      if (!merged || CLASS_RANK[next.stepClass] > CLASS_RANK[state.origin.cls]) {
        state.origin = { cls: next.stepClass, reason: next.reason }
      }
      // Channel ② brief entry (every originating message adds information).
      const fold = foldVolume(text)
      state.briefs.push({ tick: state.tick, tokens: fold.tokens, effective: effectiveOf(cfg, fold) })
    } else if (!merged) {
      // Empty origin (e.g. a subagent whose spawn text never surfaced):
      // standard by default — the approved subagent fallback.
      state.origin = { cls: 'standard', reason: [] }
    }
    state.taskOpen = true
    state.claimTick = state.tick
    if (typeof turn === 'number' && turn > state.lastTurn) state.lastTurn = turn
    // Prune brief entries beyond the long window (measured in steps).
    const horizon = state.tick - longWindowOf(cfg)
    while (state.briefs.length > 0 && state.briefs[0].tick < horizon) state.briefs.shift()
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

  /** Seal a bucket into the ring and evict the oldest beyond the LONG window. */
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

  /** Has this exact user text already been claimed (any open claim line)? */
  function alreadyClaimed(state, text) {
    const needle = text.trim()
    for (const value of state.claimed.values()) {
      for (const line of value.split('\n')) {
        if (line.trim() === needle) return true
      }
    }
    return false
  }

  /**
   * Fold newly appended messages into the evidence windows.
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
   *
   * A v4 plain-text user message the claim stream never announced opens a
   * task synthetically (interjection / question answer / resumed window).
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
    const windowSize = longWindowOf(cfg)
    const fresh = messages.slice(state.seenMessages)
    state.seenMessages = messages.length
    // A user instruction followed by assistant/tool messages is a RESUMED
    // task (work already happened under it) — its warm-up is expired.
    const followedByWork = (index) => {
      for (let i = index + 1; i < fresh.length; i += 1) {
        const role = fresh[i] && (typeof fresh[i].role === 'string' ? fresh[i].role : fresh[i].type)
        if (role === 'assistant' || role === 'tool') return true
      }
      return false
    }
    for (let index = 0; index < fresh.length; index += 1) {
      const msg = fresh[index]
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
        if (!state.pending) state.pending = newBucket(state.tick, state.epoch)
        for (const call of calls) {
          const n = state.seen.get(call.key) || 0
          state.seen.set(call.key, n + 1)
          state.pending.calls.push(call.key)
          if (n >= 1) state.pending.repeats += 1
        }
      } else if (role === 'tool') {
        // v4: fold message-level error evidence + result volume, seal the step.
        const bucket = state.pending ?? newBucket(state.tick, state.epoch)
        bucket.errors += toolErrorOfMessage(msg)
        const fold = foldVolume(msg.content)
        bucket.volume += fold.tokens
        bucket.effective += effectiveOf(cfg, fold)
        if (hasSubagentCall(bucket)) state.subagentEvents.push(state.tick)
        seal(state, bucket, windowSize)
        state.pending = null
      } else if (role === 'user') {
        const content = Array.isArray(msg.content) ? msg.content : null
        if (typeof msg.content === 'string' || (content && !content.some((part) => part && part.type === 'tool-result'))) {
          // Plain user text (v4): a synthetic task boundary when the claim
          // stream never announced it (already-claimed text is skipped).
          const text = claimedText(msg)
          if (text.trim() && !alreadyClaimed(state, text)) {
            state.claimed.set(state.lastTurn + 1, text)
            openTask(state, cfg, text, state.lastTurn + 1)
            if (followedByWork(index)) {
              state.claimTick = state.tick - warmUpSteps(cfg) - 1
            }
          }
          continue
        }
        if (!content) continue
        // v0/v3: tool results arrive as user-role tool-result blocks.
        const bucket = state.pending ?? newBucket(state.tick, state.epoch)
        bucket.errors += toolErrorsOf(content)
        const fold = foldVolume(content)
        bucket.volume += fold.tokens
        bucket.effective += effectiveOf(cfg, fold)
        if (hasSubagentCall(bucket)) state.subagentEvents.push(state.tick)
        seal(state, bucket, windowSize)
        state.pending = null
      }
    }
  }

  /**
   * Fold newly appended session EVENTS into the compaction channel (0.2.9).
   * Reads session.snapshotEvents?.() behind guards — never session.events
   * (design rule 1). The event log grows across compactions (a checkpoint
   * is itself an event), so the watermark is monotonic within a session; a
   * shrink (branch switch, host reload) resyncs silently. Advisory like the
   * projections: any failure degrades to "no signal" without a warning.
   */
  function scanCompactionEvents(agent, state) {
    try {
      const session = agent && agent.session
      if (!session || typeof session.snapshotEvents !== 'function') return
      const events = session.snapshotEvents()
      if (!Array.isArray(events)) return
      if (events.length <= state.eventWatermark) {
        state.eventWatermark = events.length
        return
      }
      let found = false
      for (let i = state.eventWatermark; i < events.length; i += 1) {
        if (isCompactionEvent(events[i])) {
          found = true
          break
        }
      }
      state.eventWatermark = events.length
      if (found) state.compactionEvents.push(state.tick)
    } catch (_advisory) { /* a bonus channel degrades silently */ }
  }

  /** Decay weight of one bucket by recency rank (0 = newest). */
  function decayAt(cfg, age) {
    const weights = Array.isArray(cfg.errorDecay) && cfg.errorDecay.length > 0
      ? cfg.errorDecay
      : [1]
    return weights[Math.min(age, weights.length - 1)]
  }

  /**
   * SHORT-window sums: the newest shortWindow sealed buckets of the CURRENT
   * task epoch plus the open one, decay-weighted (newest first). Raw counts
   * ride along for the log. Buckets of previous epochs are invisible here
   * (the long volume window still reads them).
   */
  function shortSums(state, cfg) {
    const size = shortWindowOf(cfg)
    const buckets = []
    for (const bucket of state.ring) {
      if (bucket.epoch === state.epoch) buckets.push(bucket)
    }
    if (state.pending) buckets.push(state.pending)
    const start = Math.max(0, buckets.length - size)
    let errors = 0
    let repeats = 0
    let weightedErrors = 0
    let weightedRepeats = 0
    for (let i = start; i < buckets.length; i += 1) {
      const age = buckets.length - 1 - i
      const w = decayAt(cfg, age)
      errors += buckets[i].errors
      repeats += buckets[i].repeats
      weightedErrors += buckets[i].errors * w
      weightedRepeats += buckets[i].repeats * w
    }
    return { errors, repeats, weightedErrors, weightedRepeats }
  }

  /** LONG-window sums over the whole ring plus the open bucket. */
  function longSums(state) {
    let volume = 0
    let effective = 0
    let toolCalls = 0
    // Trailing run of identical tool names across the window. OBSERVATION
    // ONLY (audit R4.3): recorded in the decision log so a future version can
    // judge whether "stuck on one tool" deserves its own escalation; it does
    // not enter any decision now.
    let consecSameTool = 0
    let lastName = null
    const walk = (bucket) => {
      volume += bucket.volume
      effective += bucket.effective
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
    return { volume, effective, toolCalls, consecSameTool }
  }

  /** Keep the claimed-text map bounded over long sessions. */
  function prune(state, turn) {
    for (const key of state.claimed.keys()) {
      if (key < turn - 4) state.claimed.delete(key)
    }
  }

  /**
   * A claimed user message opens a task (channel ④): classify the origin,
   * apply the warm-up merge rule, and carry an unresolved failure forward
   * on a real boundary.
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

    state.claimed.set(turn, (state.claimed.get(turn) || '') + '\n' + text)
    openTask(state, cfg, text, turn)
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
  function projectionSignals(agent, cfg, state) {
    const out = {
      pressure: null,
      sessionTokens: 0,
      delegationDepth: depthOf(agent),
      frugal: false,
      frugalWhy: '',
    }
    if (projections && typeof projections.stateOf === 'function' && agent && agent.session) {
      const read = (key) => { try { return projections.stateOf(agent.session, key) } catch (_unreadable) { return undefined } }
      out.pressure = contextPressureRatio(read('contextPressure'))
      out.sessionTokens = sessionTokensOf(read('tokenUsage'))
      // Channel ① todo completion: a status TRANSITION to completed inside
      // the short window bumps +1 (the next subtask is starting). Items are
      // matched by content, so a rewritten todo list produces no false
      // completions; several completions in one step fire one bump.
      if (cfg.todoBump !== false) {
        const todos = read('todos')
        if (Array.isArray(todos)) {
          const curr = new Map()
          for (const item of todos) {
            if (item && typeof item.content === 'string') curr.set(item.content, item.status)
          }
          if (state.prevTodos) {
            let completed = 0
            for (const [content, status] of curr) {
              const prev = state.prevTodos.get(content)
              if ((status === 'completed' || status === 'done') && prev !== undefined && prev !== status) {
                completed += 1
              }
            }
            if (completed > 0) state.todoEvents.push(state.tick)
            // Keep the event list bounded to the window's reach.
            const horizon = state.tick - shortWindowOf(cfg) - 1
            while (state.todoEvents.length > 0 && state.todoEvents[0] < horizon) state.todoEvents.shift()
          }
          state.prevTodos = curr
        }
      }
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
    scanCompactionEvents(agent, state)
    if (turn > state.lastTurn) state.lastTurn = turn
    state.tick += 1

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

    if (!state.taskOpen) {
      // Resumed window with no observed claim: classify the last user text
      // once, with the warm-up already EXPIRED (the task's age is unknown —
      // a floor we cannot date would pin the whole resumed session).
      const text = state.claimed.get(turn) ?? lastUserText(messages)
      openTask(state, cfg, text || '', turn)
      // Warm-up covers the task's first warmUpSteps steps (tick-claimTick
      // <= warmUpSteps); a resumed task is one step BEYOND that horizon.
      state.claimTick = state.tick - warmUpSteps(cfg) - 1
    }

    const short = shortSums(state, cfg)
    const long = longSums(state)
    const projected = projectionSignals(agent, cfg, state)
    const shortSize = shortWindowOf(cfg)
    const todoBump = cfg.todoBump !== false
      && state.todoEvents.length > 0
      && state.tick - state.todoEvents[state.todoEvents.length - 1] < shortSize
      ? 1
      : 0
    const subagentReturn = cfg.subagentReturnBump !== false
      && state.subagentEvents.length > 0
      && state.tick - state.subagentEvents[state.subagentEvents.length - 1] < shortSize
      ? 1
      : 0
    const compaction = cfg.compactionBump !== false
      && state.compactionEvents.length > 0
      && state.tick - state.compactionEvents[state.compactionEvents.length - 1] < shortSize
      ? 1
      : 0
    // Prune the event lists beyond the window's reach (todoEvents prunes in
    // projectionSignals, where it folds).
    const eventHorizon = state.tick - shortSize - 1
    while (state.subagentEvents.length > 0 && state.subagentEvents[0] < eventHorizon) state.subagentEvents.shift()
    while (state.compactionEvents.length > 0 && state.compactionEvents[0] < eventHorizon) state.compactionEvents.shift()
    const carry = state.carry > 0 && state.tick - state.carryTick < shortSize ? state.carry : 0

    // Channel ② brief sums over the long window (steps).
    let briefRaw = 0
    let briefEffective = 0
    const horizon = state.tick - longWindowOf(cfg)
    for (const entry of state.briefs) {
      if (entry.tick < horizon) continue
      briefRaw += entry.tokens
      briefEffective += entry.effective
    }
    const currentBrief = state.briefs.length > 0 ? state.briefs[state.briefs.length - 1] : null

    return {
      turn,
      // Channel ④ origin anchor.
      originClass: state.origin.cls,
      originReason: state.origin.reason,
      warmup: state.tick - state.claimTick <= warmUpSteps(cfg),
      // Channel ① short-window evidence (decay-weighted + raw for the log).
      weightedErrors: short.weightedErrors,
      weightedRepeats: short.weightedRepeats,
      taskErrors: short.errors,
      taskRepeats: short.repeats,
      todoBump,
      subagentReturn,
      compaction,
      carry,
      // Channel ② long-window information volume (effective = discounted).
      briefVolume: briefEffective,
      toolVolume: long.effective,
      /** Observation fields for the decision log. */
      briefTokens: currentBrief ? currentBrief.tokens : 0,
      briefEffective: currentBrief ? currentBrief.effective : 0,
      briefVolumeRaw: briefRaw,
      toolVolumeRaw: long.volume,
      toolCalls: long.toolCalls,
      /** Trailing identical-tool run (observation only, audit R4.3). */
      consecSameTool: long.consecSameTool,
      /** Shape fact: a reasoning-less tool-call turn exists in history. The
       *  host decides whether it is POISON (provenance-gated); never read this
       *  as "thinking was off" on its own. */
      offShapeHistory: state.offShapeHistory,
      ...projected,
    }
  }

  return { collect, onClaimed, stateOf }
}
