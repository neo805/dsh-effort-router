/**
 * dsh-effort-router — step classification & effort policy (pure, import-free).
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/policy.js (MIT,
 * Copyright Neptune810), reduced to the EFFORT-ONLY problem: this plugin never
 * routes the model, only the reasoning effort of the model the step already
 * runs on.
 *
 * 0.2.0 world view — ONE currency, the step class; every signal speaks
 * "±N classes, capped":
 *
 *   1. Cheap by default. A step is classified by its SHAPE (what kind of work
 *      the brief describes), not by a score that ratchets upward as the
 *      session grows. The 0.1.x complexity score is retired from decisions
 *      (telemetry only); its single tiebreaker duty (engineering+82 -> hard)
 *      was redundant with the dense-cue rules below.
 *   2. Escalate on the LOUDEST evidence. Tool errors, identical-argument
 *      retries, brief text volume, and recent tool-result volume each earn
 *      class bumps inside a sliding window; the applied lift is the MAX of
 *      the bumps (never their sum), capped at maxEscalations per task. A step
 *      carried over from an unresolved failure of the previous task starts
 *      one class higher.
 *   3. "max" is allowed by default (0.2.0): the hard class routes to max.
 *      Setting allowMax=false collapses it to maxFallback (default "high").
 *   4. Thinking stays on. "off" is never an automatic route: on strict
 *      thinking-mode APIs a non-thinking assistant turn that carries a tool
 *      call makes every later thinking-enabled request in the same
 *      conversation fail. The single exception is RECOVERY, and it is
 *      provenance-gated (0.2.x): the caller sets signals.poisonedHistory only
 *      when the shape suspect (a reasoning-less tool-call turn exists) is
 *      backed by decision-store proof that a step actually ran at manual off.
 *      Shape alone proves nothing — models like kimi-K3 emit no reasoning
 *      blocks before tool calls with thinking ON.
 *
 * Classification cue pipeline (three isomorphic signal kinds):
 *   - DICTIONARY cues: strong / normal / cheap / wish word lists. English
 *     cues match on word boundaries (no 'capital' -> 'api' false hits);
 *     CJK cues match as substrings. Users may extend every list via config.
 *   - SHAPE cues: code fences / diffs / XML / code tokens, plan-like lists.
 *   - VOLUME cues: brief token estimate and sliding-window tool-result tokens
 *     (log-scaled ladders; cheap-intent steps are exempt).
 *
 * The wish detector fires ONLY in the vacuum zone (no strong/shape/cheap/
 * normal cue): a short brief carrying a delegation verb ("帮我", "can you",
 * ...) is an underspecified task and starts at the engineering floor. It
 * sets the starting line; evidence takes over from there.
 *
 * Class -> effort (all overridable through the plugin config routes table):
 *   trivial     -> low
 *   standard    -> low
 *   engineering -> high
 *   hard        -> max
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
  /** Automatic routing reaches max by default; false collapses it to maxFallback. */
  allowMax: true,
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

  /** Rule 2 — evidence thresholds, counted inside the sliding window. */
  escalateOnErrors: 2,
  escalateOnRepeats: 3,
  maxEscalations: 2,
  /** Carry one hesitant step up when the previous task ended on an unresolved failure. */
  carryUnresolved: true,

  /**
   * Classification & escalation weights. The step CLASS drives the effort;
   * there is no score in the decision path (0.2.0).
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
    /** A cheap-intent step stays trivial only while at most this many tokens. */
    trivialTokenCap: 60,
    /** A vacuum-zone wish brief must be at most this long (underspecified = short). */
    wishTokenCap: 120,
    /**
     * Volume cue ladders (log-scaled, anchored on measured local session
     * distributions). Brief: >400 -> +1, >1600 -> +2. Tool-result sliding
     * window sum: >48000 -> +1, >128000 -> +2. Window covers the last
     * toolWindow step buckets. Cheap-intent steps are exempt.
     */
    briefVolumeAt: 400,
    briefVolumeBig: 1600,
    toolVolumeAt: 48000,
    toolVolumeBig: 128000,
    /** Sliding-window length in step buckets for tool evidence and volume. */
    toolWindow: 32,
  }),

  /** Engineering cues: any hit means the step is at least "engineering". */
  strong: Object.freeze([
    // en (word-boundary matched)
    'refactor', 'rewrite', 'architect', 'architecture', 'design', 'planning',
    'migrat', 'optimiz', 'performance', 'concurr', 'parallel', 'debug',
    'diagnos', 'implement', 'integr', 'deploy', 'release', 'secure',
    'encrypt', 'protocol', 'algorithm', 'distributed', 'high-avail',
    'deadlock', 'thread', 'multi-thread', 'cache', 'index', 'regression',
    'benchmark', 'dependency', 'modular', 'scalab', 'parse', 'compile',
    'reproduc', 'complex', 'asynchron', 'crash', 'race', 'deadline',
    'pipeline', 'replicat', 'consisten', 'transact', 'auth', 'api',
    // zh (substring matched)
    '重构', '架构', '设计', '规划', '迁移', '优化', '性能', '并发', '并行',
    '调试', '诊断', '排查', '实现', '集成', '部署', '发布', '安全', '加密',
    '协议', '算法', '数据结构', '分布式', '高并发', '压测', '兼容', '异常',
    '崩溃', '死锁', '多线程', '缓存', '索引', '回归', '基准', '遥测',
    '依赖', '模块化', '扩展', '解析', '编译', '异步', '竞态', '流水线',
    '副本', '一致性', '事务', '鉴权', '认证',
  ]),
  /** Light cues: raise the (telemetry) score, never the class. */
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
    'one-liner', 'what does', 'what is', 'who is', 'define', 'spell',
    // zh
    '翻译', '改名', '重命名', '错别字', '格式化', '总结一下', '一句话',
    '是什么', '谁是', '什么意思',
  ]),
  /**
   * Wish cues: delegation / uncertainty verbs. They fire ONLY in the vacuum
   * zone (no strong/shape/cheap/normal cue) on a short brief — an
   * underspecified delegated task. Bare question marks are deliberately NOT
   * cues (punctuation is not intent).
   */
  wish: Object.freeze([
    // en
    'help me', 'can you', 'could you', 'how do i', 'how to', 'what about',
    'discuss', 'brainstorm', 'build me', 'make me',
    // zh
    '帮我', '能不能', '可否', '如何', '怎么办', '讨论一下', '想想',
    '出个方案', '搞一个', '做一个', '弄一个',
  ]),
})

/** Rough token count: latin words plus CJK characters. */
export function tokenEstimate(text) {
  const latin = (text.match(/[A-Za-z0-9_'-]+/g) || []).length
  let cjk = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) cjk += 1
  }
  return latin + cjk
}

const CJK_RE = /[㐀-鿿豈-﫿]/
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

/**
 * Compile a cue list into matchers. CJK cues match as substrings (no word
 * boundaries exist); latin cues match on \b word boundaries so 'capital' no
 * longer scores an 'api' hit, 'sparse' no longer scores 'parse'.
 */
function compileCues(words) {
  const out = []
  for (const raw of words) {
    const word = String(raw).trim()
    if (!word) continue
    if (CJK_RE.test(word)) {
      const needle = word.toLowerCase()
      out.push((lower) => lower.includes(needle))
    } else {
      const re = new RegExp('\\b' + word.replace(REGEX_SPECIAL, '\\$&') + '\\b', 'i')
      out.push((lower) => re.test(lower))
    }
  }
  return out
}

/** Count cue hits (matchers receive the pre-lowered text). */
function hits(lower, matchers) {
  let count = 0
  for (const test of matchers) if (test(lower)) count += 1
  return count
}

/**
 * Normalize a policy config: defaults first, caller overrides, routes
 * validated, cue lists merged (full replacement via input.strong/normal/
 * cheap/wish, or additive user cues via input.extraCues.<list>), matchers
 * precompiled.
 */
export function normalizePolicyConfig(input = {}) {
  const cfg = { ...POLICY_DEFAULTS, ...input }
  cfg.scoring = { ...POLICY_DEFAULTS.scoring, ...(input.scoring ?? {}) }
  if (cfg.scoring.toolCallClass !== 'engineering') cfg.scoring.toolCallClass = 'standard'
  // The boolean switch (input.wish === false disables the detector) and the
  // dictionary (cfg.wish, an array) share a name in the public config; split
  // them here before the array assignment below would hide the flag.
  cfg.wishEnabled = input.wish !== false
  const extra = input.extraCues && typeof input.extraCues === 'object' ? input.extraCues : {}
  const mergeCues = (name) => {
    if (Array.isArray(input[name])) return [...input[name]]
    const add = Array.isArray(extra[name]) ? extra[name] : []
    return [...POLICY_DEFAULTS[name], ...add]
  }
  cfg.strong = mergeCues('strong')
  cfg.normal = mergeCues('normal')
  cfg.cheap = mergeCues('cheap')
  cfg.wish = mergeCues('wish')
  cfg.matchers = {
    strong: compileCues(cfg.strong),
    normal: compileCues(cfg.normal),
    cheap: compileCues(cfg.cheap),
    wish: compileCues(cfg.wish),
  }
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

/** Tool calls issued by one assistant message: [{ name, key }]. */
export function toolCallsOf(content) {
  const out = []
  if (!Array.isArray(content)) return out
  for (const part of content) {
    if (!part || part.type !== 'tool-call') continue
    const name = String(part.name ?? '')
    // Arguments arrive as a JSON string on current hosts; stringify any other
    // shape so distinct calls never collapse onto "[object Object]" and false
    // identical-argument repeats never fire.
    const raw = part.arguments
    const args = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null) || ''
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
 * SHAPE SUSPECT ONLY — this is the payload shape a strict thinking-mode API
 * rejects, NOT proof that thinking was disabled: models like kimi-K3 emit no
 * reasoning block before tool calls with thinking on. The host pins off only
 * when this shape is backed by decision-store provenance (a manual off step).
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

/** Does the text carry code / diff / markup structure? */
export function isStructural(text, lower) {
  const fenceCount = (text.split(TRIPLE_TICK).length - 1) / 2
  const diffLike = /\bdiff\s+--git\b|\b---\s+a\/|\+\+\+\s+b\//.test(text)
  const xmlLike = /<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?>/.test(text)
  return fenceCount >= 1 || diffLike || xmlLike ||
    /\b(?:function|class|interface|const|let|def|import\s|from\s|=>)\b/.test(lower)
}

/** Multi-step-plan phrasing (shared by the plan cue and the plan-like shape). */
const PLAN_PHRASE_RE = /step\s+by\s+step|first\s*[,.]|then\s*[,.]|步骤|首先|然后|按以下|如下/

/** Does the text read like a multi-step plan? */
export function isPlanLike(lower, text, cfg = POLICY_DEFAULTS) {
  if (PLAN_PHRASE_RE.test(lower)) return true
  const bulletLines = (text.split('\n') ?? []).filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length
  if (bulletLines >= cfg.scoring.bulletMinLines) return true
  return (text.match(/\d+[).]/g) || []).length >= 3
}

/**
 * Deterministic complexity score in [0, 100]. TELEMETRY ONLY since 0.2.0:
 * the decision path reads classes, never this number. Kept for the decision
 * log and for one-version debugging; do not reintroduce it into decisions.
 * @returns an object { score, reason }.
 */
export function scoreOf(signals, cfg = POLICY_DEFAULTS) {
  const s = cfg.scoring
  const text = signals.text ?? ''
  const lower = text.toLowerCase()
  const reason = []
  const matchers = cfg.matchers ?? {
    strong: compileCues(cfg.strong ?? []),
    normal: compileCues(cfg.normal ?? []),
    cheap: compileCues(cfg.cheap ?? []),
    wish: compileCues(cfg.wish ?? []),
  }

  let score = 6
  if (text) {
    score += Math.min(s.lengthCap, Math.floor(tokenEstimate(text) / s.lengthPerPoint))
    if (isStructural(text, lower)) {
      score += s.codeSignal
      reason.push('code/diff markup')
    }
  }
  const strong = hits(lower, matchers.strong)
  const normal = hits(lower, matchers.normal)
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
  if (PLAN_PHRASE_RE.test(lower)) {
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
 * Classify one step by its shape, through the cue pipeline (dictionary /
 * shape / volume cues). Escalation is decideEffort's job; this only reads
 * the brief itself.
 * @returns an object { stepClass, reason }.
 */
export function classifyStep(signals, cfg = POLICY_DEFAULTS) {
  const s = cfg.scoring
  const text = signals.text ?? ''
  const lower = text.toLowerCase()
  const matchers = cfg.matchers ?? {
    strong: compileCues(cfg.strong ?? []),
    normal: compileCues(cfg.normal ?? []),
    cheap: compileCues(cfg.cheap ?? []),
    wish: compileCues(cfg.wish ?? []),
  }
  const strong = hits(lower, matchers.strong)
  const cheap = hits(lower, matchers.cheap)
  const normal = hits(lower, matchers.normal)
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
  const tokens = tokenEstimate(text)
  if (cheap > 0 && tokens <= s.trivialTokenCap) {
    return { stepClass: 'trivial', reason: ['cheap intent, short step'] }
  }
  // Wish floor: the vacuum zone (no strong/shape/cheap/normal cue) plus a
  // delegation verb on a short brief = an underspecified task. It starts at
  // the engineering floor; evidence takes over from there.
  if (cfg.wishEnabled !== false && cheap === 0 && normal === 0 && tokens <= s.wishTokenCap) {
    if (hits(lower, matchers.wish) > 0) {
      return { stepClass: 'engineering', reason: ['underspecified delegation (wish cue)'] }
    }
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
 * Evidence bumps from tool errors / identical-argument repeats inside the
 * sliding window. Pure; the collector feeds the raw window counters.
 */
export function evidenceBumps(errors, repeats, cfg = POLICY_DEFAULTS) {
  let n = 0
  const onErrors = Math.max(1, Number(cfg.escalateOnErrors) || 2)
  const onRepeats = Math.max(2, Number(cfg.escalateOnRepeats) || 3)
  if (errors >= onErrors) n = Math.max(n, 1)
  if (errors >= onErrors * 2) n = Math.max(n, 2)
  if (repeats >= onRepeats) n = Math.max(n, 1)
  return Math.min(Math.max(1, Number(cfg.maxEscalations) || 2), n)
}

/** Log-scaled volume ladder: over `at` earns +1, over `big` earns +2. */
function volumeBumps(tokens, at, big) {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0
  if (big > at && tokens > big) return 2
  if (at > 0 && tokens > at) return 1
  return 0
}

/**
 * Apply rule 3 to one tier: max is opt-out.
 * @returns an object { tier, changed, why }.
 */
export function clampTier(tier, cfg = POLICY_DEFAULTS) {
  if (tier !== TIER_MAX) return { tier, changed: false, why: '' }
  if (cfg.allowMax) return { tier, changed: false, why: '' }
  const fallback = cfg.maxFallback ?? TIER_HIGH
  return { tier: fallback, changed: true, why: 'max is opt-out; fell back to ' + fallback }
}

/**
 * Full effort decision for one step, pure. Caller (host) applies hysteresis and
 * maps the tier onto the target model's advertised vocabulary.
 *
 * @param cfg - normalized policy config (see normalizePolicyConfig).
 * @param signals {
 *   text, turn, toolCalls,
 *   escalations     evidence bumps earned inside the window (0..maxEscalations)
 *   briefTokens     token estimate of the assembled brief
 *   toolVolume      sliding-window sum of tool-result tokens
 *   carry           1 when the previous task ended on an unresolved failure
 *   poisonedHistory caller-proven poison: reasoning-less tool-call turn in
 *                   history AND a recorded manual-off step (never shape alone)
 *   frugal          cheap-tier signal (pressure / budget / subagent)
 *   frugalWhy       human-readable source of the frugal signal
 * }
 * @returns { tier, stepClass, baseClass, score, reason[], poisoned }
 *          (score is telemetry only — no decision reads it)
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

  const s = cfg.scoring
  const { score } = scoreOf(signals, cfg)
  const base = classifyStep(signals, cfg)
  let stepClass = base.stepClass
  const reason = [...base.reason]

  // Rule 2 — the LOUDEST evidence wins; bumps never stack. Cheap-intent
  // steps are exempt from volume lifts (a long paste to translate is still
  // a trivial task).
  const evidence = Math.max(0, Math.min(cfg.maxEscalations, Number(signals.escalations) || 0))
  const exempt = base.stepClass === 'trivial'
  const briefBump = exempt ? 0 : volumeBumps(signals.briefTokens, s.briefVolumeAt, s.briefVolumeBig)
  const toolBump = exempt ? 0 : volumeBumps(signals.toolVolume, s.toolVolumeAt, s.toolVolumeBig)
  const carry = signals.carry && (stepClass === 'engineering' || stepClass === 'hard') ? 1 : 0
  const bumps = Math.max(evidence, briefBump, toolBump, carry)
  if (bumps > 0) {
    const sources = []
    if (evidence === bumps) sources.push('escalated on evidence')
    if (briefBump === bumps) sources.push('brief volume')
    if (toolBump === bumps) sources.push('tool-result volume')
    if (carry === bumps) sources.push('carried from unresolved failure')
    const lifted = escalateClass(stepClass, bumps)
    if (lifted !== stepClass) {
      reason.push(sources.join(' + ') + ' x' + bumps)
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
