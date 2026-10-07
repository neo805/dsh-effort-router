/**
 * dsh-effort-router — step classification & effort policy (pure, import-free).
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/policy.js (MIT,
 * Copyright Neptune810), reduced to the EFFORT-ONLY problem: this plugin never
 * routes the model, only the reasoning effort of the model the step already
 * runs on.
 *
 * The policy in four rules:
 *
 *   1. Cheap by default. A step is classified by its SHAPE (what kind of work
 *      the brief describes), not by a score that ratchets upward as the
 *      session grows. A long agent run is not a harder task, so turn depth and
 *      cumulative tool-call counts do not raise the effort on their own.
 *   2. Escalate on evidence. Repeated tool failures, or the same tool call
 *      retried with identical arguments, step the class up — at most
 *      maxEscalations times per task. A step carried over from an unresolved
 *      failure of the previous task starts one class higher.
 *   3. "max" is opt-in. Automatic routing never emits "max" unless allowMax is
 *      set; the hard class falls back to maxFallback (default "high").
 *   4. Thinking stays on. "off" is never an automatic route: a non-thinking
 *      assistant turn that carries a tool call makes every later
 *      thinking-enabled request in the same conversation fail on thinking-mode
 *      APIs. The single exception is RECOVERY: when the history is already
 *      poisoned (a tool call without a reasoning block exists), thinking must
 *      stay off until a compaction removes the offending turn.
 *
 * Class -> effort (all overridable through the plugin config routes table):
 *   trivial     -> low
 *   standard    -> low
 *   engineering -> high
 *   hard        -> max (opt-in; clamped to maxFallback otherwise)
 *
 * Frugal signals (context pressure, session token budget, subagent depth) may
 * demote the class by ONE step when frugalDemote is on: under pressure the
 * cheaper tier protects the budget, and the demotion is logged in the reason.
 *
 * The module has zero imports, so it is unit-testable anywhere.
 */

/** Internal tier ladder the scheduler emits (a subset of the adapter vocab). */
export const TIER_LOW = 'low'
export const TIER_HIGH = 'high'
export const TIER_MAX = 'max'

/** Step classes, ascending by effort. */
export const STEP_CLASSES = Object.freeze(['trivial', 'standard', 'engineering', 'hard'])

/** The highest class the escalation ladder reaches. */
export const AUTO_CEILING = 'hard'

/** Class -> internal tier. Plain strings; validated against VALID_ROUTE_TIERS. */
export const DEFAULT_ROUTES = Object.freeze({
  trivial: TIER_LOW,
  standard: TIER_LOW,
  engineering: TIER_HIGH,
  hard: TIER_MAX,
})

/** Tiers a route table entry may name. "off" is never a route (rule 4). */
export const VALID_ROUTE_TIERS = Object.freeze([TIER_LOW, TIER_HIGH, TIER_MAX])

/** Shipped defaults for the policy-relevant config keys. */
export const POLICY_DEFAULTS = Object.freeze({
  /** Automatic routing never reaches "max" while this is false. */
  allowMax: false,
  /** What "max" collapses to when allowMax is false. */
  maxFallback: TIER_HIGH,
  /** Frugal signals (pressure/budget/subagent) demote the class one step. */
  frugalDemote: true,
  /** Downgrades need this many consecutive quieter decisions before they apply. */
  downAfter: 2,
  /** Subagents run cheap unless configured otherwise. */
  subagentPreferCheap: true,
  /** Context occupancy ratio at/above which the frugal signal fires; 0 disables. */
  contextPressure: 0.75,
  /** Session token total at/above which the frugal signal fires; 0 disables. */
  sessionTokenBudget: 0,

  /** Rule 2 — evidence thresholds, counted inside one task. */
  escalateOnErrors: 2,
  escalateOnRepeats: 3,
  maxEscalations: 2,
  /** Carry one hesitant step up when the previous task ended on an unresolved failure. */
  carryUnresolved: true,

  /**
   * Complexity scoring weights. The score is informational and acts only as a
   * tiebreaker (hardScore); the step CLASS drives the effort.
   */
  scoring: Object.freeze({
    lengthPerPoint: 6,
    lengthCap: 26,
    codeSignal: 9,
    strongVerbPerHit: 4,
    strongVerbCap: 24,
    denseStrongThreshold: 5,
    denseStrongBonus: 20,
    denseStrongBig: 10,
    denseStrongBigBonus: 24,
    normalVerbPerHit: 2,
    normalVerbCap: 6,
    planSignal: 6,
    bulletSignal: 6,
    bulletMinLines: 4,
    turnPerPoint: 0,
    turnCap: 3,
    toolCallBase: 5,
    toolCallAt: 3,
    toolCallBig: 8,
    /**
     * The class a step earns from tool activity alone. "standard" keeps a plain
     * tool loop cheap: the task brief decides whether the work is really
     * engineering, while errors and repeats still escalate on evidence.
     */
    toolCallClass: 'standard',
    /** An engineering-class step scoring at least this high is promoted to hard. */
    hardScore: 82,
    /** A cheap-intent step stays trivial only while at most this many tokens. */
    trivialTokenCap: 60,
  }),

  /** Engineering cues: any hit means the step is at least "engineering". */
  strong: Object.freeze([
    // en
    'refactor', 'rewrite', 'architect', 'architecture', 'design', 'planning',
    'migrat', 'optimiz', 'performance', 'concurr', 'parallel', 'debug',
    'diagnos', 'implement', 'integr', 'deploy', 'release', 'secure',
    'encrypt', 'protocol', 'algorithm', 'distributed', 'high-avail',
    'deadlock', 'thread', 'multi-thread', 'cache', 'index', 'regression',
    'benchmark', 'dependency', 'modular', 'scalab', 'parse', 'compile',
    'reproduc', 'complex', 'asynchron', 'crash', 'race', 'deadline',
    'pipeline', 'replicat', 'consisten', 'transact', 'auth', 'api',
    // zh
    '重构', '架构', '设计', '规划', '迁移', '优化', '性能', '并发', '并行',
    '调试', '诊断', '排查', '实现', '集成', '部署', '发布', '安全', '加密',
    '协议', '算法', '数据结构', '分布式', '高并发', '压测', '兼容', '异常',
    '崩溃', '死锁', '多线程', '缓存', '索引', '回归', '基准', '遥测',
    '依赖', '模块化', '扩展', '解析', '编译', '异步', '竞态', '流水线',
    '副本', '一致性', '事务', '鉴权', '认证',
  ]),
  /** Light cues: raise the score, never the class. */
  normal: Object.freeze([
    // en
    'explain', 'summarize', 'translate', 'suggest', 'format', 'typo',
    'rename', 'help me', 'what is', 'write a', 'short', 'simple',
    // zh
    '解释', '总结', '翻译', '推荐', '格式化', '错别字', '改名', '简单',
    '简短', '帮我看看', '说明一下',
  ]),
  /** Cheap-intent cues: a short step matching one of these stays trivial. */
  cheap: Object.freeze([
    // en
    'translate', 'rename', 'typo', 'reformat', 'format this', 'summarize',
    'one-liner', 'what does', 'what is', 'who is', 'define ', 'spell',
    // zh
    '翻译', '改名', '重命名', '错别字', '格式化', '总结一下', '一句话',
    '是什么', '谁是', '什么意思',
  ]),
})

/** Normalize a policy config: defaults first, caller overrides, routes validated. */
export function normalizePolicyConfig(input = {}) {
  const cfg = { ...POLICY_DEFAULTS, ...input }
  cfg.scoring = { ...POLICY_DEFAULTS.scoring, ...(input.scoring ?? {}) }
  if (cfg.scoring.toolCallClass !== 'engineering') cfg.scoring.toolCallClass = 'standard'
  cfg.strong = Array.isArray(input.strong) ? input.strong : [...POLICY_DEFAULTS.strong]
  cfg.normal = Array.isArray(input.normal) ? input.normal : [...POLICY_DEFAULTS.normal]
  cfg.cheap = Array.isArray(input.cheap) ? input.cheap : [...POLICY_DEFAULTS.cheap]
  const given = input.routes && typeof input.routes === 'object' ? input.routes : {}
  const routes = {}
  for (const key of STEP_CLASSES) {
    const tier = given[key]
    routes[key] = VALID_ROUTE_TIERS.includes(tier) ? tier : DEFAULT_ROUTES[key]
  }
  cfg.routes = routes
  return cfg
}

const TRIPLE_TICK = String.fromCharCode(96).repeat(3)

/** Extract plain text from a message content block list (or string). */
export function textOfContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    let out = ''
    for (const part of content) {
      if (part == null) continue
      if (typeof part === 'string') out += part
      else if (part.type === 'text' && typeof part.text === 'string') out += part.text
      else if (part.type === 'image') out += ' [image] '
      else if (part.type === 'tool-result' && part.content) out += textOfContent(part.content)
    }
    return out
  }
  return ''
}

/** Does a content block list carry an image? */
export function contentHasImage(content) {
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === 'image') return true
      if (part && part.type === 'tool-result' && contentHasImage(part.content)) return true
    }
  }
  return false
}

/** Tool calls issued by one assistant message: [{ name, key }]. */
export function toolCallsOf(content) {
  const out = []
  if (!Array.isArray(content)) return out
  for (const part of content) {
    if (!part || part.type !== 'tool-call') continue
    const name = String(part.name ?? '')
    const args = String(part.arguments ?? '')
    out.push({ name, key: name + '|' + (args.length > 400 ? args.slice(0, 400) : args) })
  }
  return out
}

/**
 * Strong textual failure markers inside a tool result. The harness reports a
 * non-zero process exit as "[exit code: N]", the most reliable signal available.
 */
export const ERROR_TEXT = /\[exit code: [1-9][0-9]*\]|(?:^|\n)\s*(?:Traceback \(most recent call last\)|Errors?:|Exception|FATAL|Fatal error|panic:|错误|失败|异常|报错)/

/**
 * Does one assistant message carry a tool call but no reasoning block?
 * Such a turn was produced with thinking disabled. Thinking-mode APIs reject
 * any later thinking-enabled request in the same conversation, so the router
 * has to keep thinking off once one exists.
 */
export function toolCallWithoutReasoning(content) {
  if (!Array.isArray(content)) return false
  let call = false
  let reasoning = false
  for (const part of content) {
    if (!part) continue
    if (part.type === 'reasoning') reasoning = true
    else if (part.type === 'tool-call') call = true
  }
  return call && !reasoning
}

/** How many tool results in one message look like failures. */
export function toolErrorsOf(content) {
  let errors = 0
  if (!Array.isArray(content)) return 0
  for (const part of content) {
    if (!part || part.type !== 'tool-result') continue
    if (part.isError === true) {
      errors += 1
      continue
    }
    if (ERROR_TEXT.test(textOfContent(part.content))) errors += 1
  }
  return errors
}

/** Count keywords present (case-insensitive substring). */
function hits(text, words) {
  const lower = text.toLowerCase()
  let count = 0
  for (const word of words) if (lower.includes(String(word).toLowerCase())) count += 1
  return count
}

/** Rough token count: latin words plus CJK characters. */
function tokenEstimate(text) {
  const latin = (text.match(/[A-Za-z0-9_'-]+/g) || []).length
  let cjk = 0
  for (const ch of text) if (/[㐀-鿿豈-﫿]/.test(ch)) cjk += 1  // CJK Unified Ideographs ext-A..A + compat
  return latin + cjk
}

/** Does the text carry code / diff / markup structure? */
export function isStructural(text, lower) {
  const fenceCount = (text.split(TRIPLE_TICK).length - 1) / 2
  const diffLike = /\bdiff\s+--git\b|\b---\s+a\/|\+\+\+\s+b\//.test(text)
  const xmlLike = /<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?>/.test(text)
  return fenceCount >= 1 || diffLike || xmlLike ||
    /\b(?:function|class|interface|const|let|def|import\s|from\s|=>)\b/.test(lower)
}

/** Does the text read like a multi-step plan? */
export function isPlanLike(lower, text, cfg = POLICY_DEFAULTS) {
  if (/step\s+by\s+step|first\s*[,.]|then\s*[,.]|步骤|首先|然后|按以下|如下/.test(lower)) return true
  const bulletLines = (text.split('\n') ?? []).filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length
  if (bulletLines >= cfg.scoring.bulletMinLines) return true
  return (text.match(/\d+[).]/g) || []).length >= 3
}

/**
 * Deterministic complexity score in [0, 100]. Informational: the class comes
 * from classifyStep, and this score only breaks the engineering/hard tie.
 * @returns an object { score, reason }.
 */
export function scoreOf(signals, cfg = POLICY_DEFAULTS) {
  const s = cfg.scoring
  const text = signals.text ?? ''
  const lower = text.toLowerCase()
  const reason = []

  let score = 6
  if (text) {
    score += Math.min(s.lengthCap, Math.floor(tokenEstimate(text) / s.lengthPerPoint))
    if (isStructural(text, lower)) {
      score += s.codeSignal
      reason.push('code/diff markup')
    }
  }
  const strong = hits(text, cfg.strong)
  const normal = hits(text, cfg.normal)
  if (strong > 0) {
    score += Math.min(s.strongVerbCap, strong * s.strongVerbPerHit)
    if (strong >= s.denseStrongBig) {
      score += s.denseStrongBigBonus
      reason.push('dense engineering brief (' + strong + ')')
    } else if (strong >= s.denseStrongThreshold) {
      score += s.denseStrongBonus
      reason.push('engineering brief (' + strong + ')')
    }
  }
  if (normal > 0) score += Math.min(s.normalVerbCap, normal * s.normalVerbPerHit)
  if (/step\s+by\s+step|first\s*[,.]|then\s*[,.]|步骤|首先|然后|按以下|如下/.test(lower)) {
    score += s.planSignal
    reason.push('multi-step request')
  }
  if (isPlanLike(lower, text, cfg)) {
    score += s.bulletSignal
    reason.push('structured list')
  }

  // Bounded and off by default: a long run must not inflate the effort.
  const turn = Number.isFinite(signals.turn) && signals.turn > 1 ? Math.min(s.turnCap, signals.turn - 1) : 0
  if (turn > 0 && s.turnPerPoint > 0) {
    score += turn * s.turnPerPoint
    reason.push('turn depth ' + signals.turn)
  }

  const toolCalls = Number.isFinite(signals.toolCalls) ? signals.toolCalls : 0
  if (toolCalls >= s.toolCallBig) {
    score += s.toolCallBase + s.toolCallAt + 2
    reason.push('tool-heavy run (' + toolCalls + ')')
  } else if (toolCalls >= s.toolCallAt) {
    score += s.toolCallBase + s.toolCallAt
    reason.push('multi-tool run (' + toolCalls + ')')
  } else if (toolCalls >= 1) {
    score += s.toolCallBase
    reason.push('tool use (' + toolCalls + ')')
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reason }
}

/**
 * Classify one step by its shape. Escalation through evidence is decideEffort's
 * job; this only reads the brief itself.
 * @returns an object { stepClass, reason }.
 */
export function classifyStep(signals, cfg = POLICY_DEFAULTS) {
  const s = cfg.scoring
  const text = signals.text ?? ''
  const lower = text.toLowerCase()
  const strong = hits(text, cfg.strong)
  const cheap = hits(text, cfg.cheap)
  const structural = isStructural(text, lower)

  if (strong >= s.denseStrongBig) {
    return { stepClass: 'hard', reason: ['dense engineering brief (' + strong + ' cues)'] }
  }
  if (strong >= s.denseStrongThreshold && (structural || isPlanLike(lower, text, cfg))) {
    return { stepClass: 'hard', reason: ['structured engineering spec (' + strong + ' cues)'] }
  }
  // Tool activity is a score signal, not a verdict: a loop of reads is not
  // engineering work. The brief (strong cues / structural text) decides the
  // class; escalation on errors and repeats can still lift it afterwards.
  const toolClass = signals.toolCalls > 0 && cfg.scoring.toolCallClass === 'engineering'
  if (strong > 0 || structural || toolClass) {
    const why = strong > 0 ? 'engineering cues (' + strong + ')'
      : structural ? 'code/diff markup'
      : 'agent tool loop'
    return { stepClass: 'engineering', reason: [why] }
  }
  if (cheap > 0 && tokenEstimate(text) <= s.trivialTokenCap) {
    return { stepClass: 'trivial', reason: ['cheap intent, short step'] }
  }
  return { stepClass: 'standard', reason: [] }
}

/** Move up the class ladder by a number of steps, capped at AUTO_CEILING. */
export function escalateClass(stepClass, bumps = 1) {
  let index = STEP_CLASSES.indexOf(stepClass)
  if (index < 0) index = STEP_CLASSES.indexOf('standard')
  const limit = STEP_CLASSES.indexOf(AUTO_CEILING)
  const steps = Math.max(0, Number(bumps) || 0)
  return STEP_CLASSES[Math.min(limit, index + steps)]
}

/** Move DOWN the class ladder by one step (frugal signals). Floors at trivial. */
export function demoteClass(stepClass) {
  let index = STEP_CLASSES.indexOf(stepClass)
  if (index < 0) index = STEP_CLASSES.indexOf('standard')
  return STEP_CLASSES[Math.max(0, index - 1)]
}

/**
 * Apply rule 3 to one tier: max is opt-in.
 * @returns an object { tier, changed, why }.
 */
export function clampTier(tier, cfg = POLICY_DEFAULTS) {
  if (tier !== TIER_MAX) return { tier, changed: false, why: '' }
  if (cfg.allowMax) return { tier, changed: false, why: '' }
  const fallback = cfg.maxFallback ?? TIER_HIGH
  return { tier: fallback, changed: true, why: 'max is opt-in; fell back to ' + fallback }
}

/**
 * Full effort decision for one step, pure. Caller (host) applies hysteresis and
 * maps the tier onto the target model's advertised vocabulary.
 *
 * @param cfg - normalized policy config (see normalizePolicyConfig).
 * @param signals {
 *   text, turn, toolCalls, hasImage,
 *   escalations     evidence steps earned inside this task (0..maxEscalations)
 *   carry           1 when the previous task ended on an unresolved failure
 *   poisonedHistory a tool call without a thinking block exists in history
 *   frugal          cheap-tier signal (pressure / budget / subagent)
 *   frugalWhy       human-readable source of the frugal signal
 * }
 * @returns { tier, stepClass, baseClass, score, reason[], poisoned }
 */
export function decideEffort(cfg, signals) {
  // Recovery path: a poisoned history must keep thinking off until compaction
  // removes the offending turn, or every thinking-enabled request fails.
  if (signals && signals.poisonedHistory) {
    return {
      tier: 'off',
      stepClass: 'standard',
      baseClass: 'standard',
      score: 0,
      reason: ['history already contains a tool call without thinking; keeping effort off'],
      poisoned: true,
    }
  }

  const { score } = scoreOf(signals, cfg)
  const base = classifyStep(signals, cfg)
  let stepClass = base.stepClass
  const reason = [...base.reason]

  // Tiebreaker: a very high score on an engineering step means it is really hard.
  if (stepClass === 'engineering' && score >= cfg.scoring.hardScore) {
    stepClass = 'hard'
    reason.push('score ' + score + ' >= hardScore')
  }

  // Rule 2 — escalation is evidence-driven and only lifts real work.
  const evidence = Math.max(0, Math.min(cfg.maxEscalations, Number(signals.escalations) || 0))
  const carry = signals.carry && (stepClass === 'engineering' || stepClass === 'hard') ? 1 : 0
  const bumps = Math.max(evidence, carry)
  if (bumps > 0) {
    const lifted = escalateClass(stepClass, bumps)
    if (lifted !== stepClass) {
      const how = carry && carry >= evidence ? 'carried from unresolved failure' : 'escalated on evidence'
      reason.push(how + ' x' + bumps)
      stepClass = lifted
    }
  }

  // Frugal signals demote ONE class: under context pressure, over the session
  // budget, or inside a subagent, cheaper thinking protects the envelope.
  if (cfg.frugalDemote && signals.frugal) {
    const lowered = demoteClass(stepClass)
    if (lowered !== stepClass) {
      reason.push('frugal: ' + (signals.frugalWhy || 'cheap signal'))
      stepClass = lowered
    }
  }

  const tier = cfg.routes[stepClass] ?? DEFAULT_ROUTES[stepClass]
  const clamped = clampTier(tier, cfg)
  if (clamped.changed) reason.push(clamped.why)

  // Rule 4 — thinking stays on (paranoia: no route may emit off).
  let out = clamped.tier
  if (out === 'off') {
    out = TIER_LOW
    reason.push('thinking stays on for tool-call continuity')
  }

  return {
    tier: out,
    stepClass,
    baseClass: base.stepClass,
    score,
    reason,
    poisoned: false,
  }
}
