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
 *      session grows. The 0.1.x complexity score is gone entirely (0.2.0
 *      retired it from decisions to telemetry; 0.2.7-rc.7 deleted the
 *      telemetry too — no decision ever read it).
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
  // 0.2.6 (audit R4.1): the FIRST error already lifts the class one step —
  // measured flip-rate 12.5% at threshold 1 with strong failure correlation;
  // threshold 2 waited for a second error that often never came. Two errors
  // still reach the +2 cap via the onErrors*2 rung in evidenceBumps.
  escalateOnErrors: 1,
  escalateOnRepeats: 3,
  maxEscalations: 2,
  /** Carry one hesitant step up when the previous task ended on an unresolved failure. */
  carryUnresolved: true,

  /**
   * Classification & escalation weights. The step CLASS drives the effort;
   * there is no score anywhere (0.2.7-rc.7 removed the telemetry-only
   * scoreOf and its weights — no decision ever read them, and the reason
   * array explains every decision better than a number).
   */
  scoring: Object.freeze({
    denseStrongThreshold: 5,
    denseStrongBig: 10,
    bulletMinLines: 4,
    /**
     * The class a step earns from tool activity alone. "standard" keeps a plain
     * tool loop cheap: the task brief decides whether the work is really
     * engineering, while errors and repeats still escalate on evidence.
     */
    toolCallClass: 'standard',
    /**
     * A cheap-intent step stays trivial only while at most this many tokens.
     * 0.2.6 (audit R4.4): 60 → 200 — measured trivial-paste briefs cluster at
     * 80–160 tokens ("translate this: …"), so the 60 cap pushed genuinely
     * trivial steps to standard and muted the cheap route.
     */
    trivialTokenCap: 200,
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

  /**
   * Engineering cues: any hit means the step is at least "engineering".
   * 0.2.6 (audit R3 / T6, difficulty-proxy supervision, 6-harness 200k-event
   * corpus): 依赖/api/异常 migrated OUT to normal (both signals leaned
   * light); 计划/搜索/评估/环境/开发/负责 added (heavy-leaning gaps).
   */
  strong: Object.freeze([
    // en (word-boundary matched)
    'refactor', 'rewrite', 'architect', 'architecture', 'design', 'planning',
    'migrat', 'optimiz', 'performance', 'concurr', 'parallel', 'debug',
    'diagnos', 'implement', 'integr', 'deploy', 'release', 'secure',
    'encrypt', 'protocol', 'algorithm', 'distributed', 'high-avail',
    'deadlock', 'thread', 'multi-thread', 'cache', 'index', 'regression',
    'benchmark', 'dependency', 'modular', 'scalab', 'parse', 'compile',
    'reproduc', 'complex', 'asynchron', 'crash', 'race', 'deadline',
    'pipeline', 'replicat', 'consisten', 'transact', 'auth',
    // zh (substring matched)
    '重构', '架构', '设计', '规划', '迁移', '优化', '性能', '并发', '并行',
    '调试', '诊断', '排查', '实现', '集成', '部署', '发布', '安全', '加密',
    '协议', '算法', '数据结构', '分布式', '高并发', '压测', '兼容',
    '崩溃', '死锁', '多线程', '缓存', '索引', '回归', '基准', '遥测',
    '模块化', '扩展', '解析', '编译', '异步', '竞态', '流水线',
    '副本', '一致性', '事务', '鉴权', '认证',
    '计划', '搜索', '评估', '环境', '开发', '负责',
  ]),
  /**
   * Light cues: raise the (telemetry) score, never the class.
   * 0.2.6 (T6): 依赖/api/异常 in from strong; 一句话/define/是什么 in from
   * cheap — they stay light cues but must NOT grant the trivial privilege
   * ("用一句话总结" is a format instruction inside heavy tasks).
   */
  normal: Object.freeze([
    // en
    'explain', 'summarize', 'translate', 'suggest', 'format', 'typo',
    'rename', 'help me', 'what is', 'write a', 'short', 'simple',
    'api', 'define',
    // zh
    '解释', '总结', '翻译', '推荐', '格式化', '错别字', '改名', '简单',
    '简短', '帮我看看', '说明一下', '依赖', '异常', '一句话', '是什么',
  ]),
  /**
   * Cheap-intent cues: a short step matching one of these stays trivial.
   * 0.2.6 (T6): 一句话/define/是什么 out to normal (heavy association
   * conflicts with the trivial privilege); return only / bullet points added
   * (output-format instructions — template-cluster support, marked for
   * review).
   */
  cheap: Object.freeze([
    // en
    'translate', 'rename', 'typo', 'reformat', 'format this', 'summarize',
    'one-liner', 'what does', 'what is', 'who is', 'spell',
    'return only', 'bullet points',
    // zh
    '翻译', '改名', '重命名', '错别字', '格式化', '总结一下',
    '谁是', '什么意思',
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

/**
 * JSON with sorted object keys (audit R4.6): the same arguments must
 * serialize to the same string regardless of key order, or identical-argument
 * repeat detection misses when the model emits keys in a different order.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    const out = JSON.stringify(value)
    return out === undefined ? '' : out
  }
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  let out = '{'
  let first = true
  for (const key of Object.keys(value).sort()) {
    if (!first) out += ','
    first = false
    out += JSON.stringify(key) + ':' + stableStringify(value[key])
  }
  return out + '}'
}

/**
 * Repeat-detection key of one tool call: name + the canonical (key-sorted)
 * argument spelling, truncated at 400 chars. An unparsable argument string
 * keeps its raw spelling — two identical raw strings still compare equal.
 */
function argKeyOf(name, rawArgs) {
  const text = typeof rawArgs === 'string' ? rawArgs : stableStringify(rawArgs ?? null)
  let canonical = text
  try {
    canonical = stableStringify(JSON.parse(text))
  } catch (_notJson) { /* keep the raw spelling */ }
  return name + '|' + (canonical.length > 400 ? canonical.slice(0, 400) : canonical)
}

/** Tool calls issued by one assistant message: [{ name, key }]. */
export function toolCallsOf(content) {
  const out = []
  if (!Array.isArray(content)) return out
  for (const part of content) {
    if (!part || part.type !== 'tool-call') continue
    const name = String(part.name ?? '')
    out.push({ name, key: argKeyOf(name, part.arguments) })
  }
  return out
}

/**
 * Textual failure markers inside a tool result (0.2.6, audit R2 / §4.3): a
 * set of focused patterns replacing the single 0.2.x regex.
 *   - EXIT_BRACKET: the harness's own "[exit code: N]" (N >= 1) — the most
 *     reliable signal available;
 *   - EXIT_LINE: a bare "Exit code: N" line (N >= 1) from tool output;
 *   - EN_MARK: line-anchored English failure markers (Traceback / Errors: /
 *     Exception / FATAL / Fatal error / panic:), tolerating a "stdout:" /
 *     "stderr:" style prefix;
 *   - CJK_MARK: line-anchored CJK markers (错误/失败/异常/报错) only when a
 *     colon, digit, or end-of-line follows — plain prose like "没有错误" no
 *     longer counts.
 * Exit-0 demotion: a CJK-only hit on text that itself reports a zero exit
 * code does NOT count as a failure (e.g. a successful run whose output merely
 * narrates a handled error).
 */
export const EXIT_BRACKET = /\[exit code: [1-9][0-9]*\]/
export const EXIT_LINE = /(?:^|\n)\s*Exit [Cc]ode:? [1-9][0-9]*(?:\r|$|\n)/
export const EN_MARK = /(?:^|\n)\s*(?:(?:[Ss]td(?:out|err)|[Oo]utput|[Ll]og|[Mm]sg|[Ee]rr?or[s]?)\s*:\s+)?(?:Traceback \(most recent call last\)|Errors?:|Exception|FATAL|Fatal error|panic:)/
export const CJK_MARK = /(?:^|\n)\s*(?:错误|失败|异常|报错)(?=\s*[:：]|\s*\d|\s*$)/
const EXIT_ZERO = /\[exit code: 0\]|(?:^|\n)\s*Exit [Cc]ode:? 0(?:\r|$|\n)/

/** Back-compat union of the four hard markers (no exit-0 demotion). */
export const ERROR_TEXT = new RegExp(
  [EXIT_BRACKET, EXIT_LINE, EN_MARK, CJK_MARK].map((re) => re.source).join('|'),
)

/**
 * Does one tool-result text carry failure evidence (audit R2 rules, with the
 * exit-0 demotion applied to CJK-only hits)?
 */
export function errorTextMatches(text) {
  if (typeof text !== 'string' || text === '') return false
  if (EXIT_BRACKET.test(text) || EXIT_LINE.test(text) || EN_MARK.test(text)) return true
  return CJK_MARK.test(text) && !EXIT_ZERO.test(text)
}

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

/** How many tool-result BLOCKS in one (v0/v3 user-role) message look like failures. */
export function toolErrorsOf(content) {
  let errors = 0
  if (!Array.isArray(content)) return 0
  for (const part of content) {
    if (!part || part.type !== 'tool-result') continue
    if (part.isError === true) {
      errors += 1
      continue
    }
    if (errorTextMatches(textOfContent(part.content))) errors += 1
  }
  return errors
}

/**
 * Failure evidence of ONE derived message in the DSH v4 shape: tool results
 * are first-class `role: "tool"` messages whose `isError` flag lives at
 * MESSAGE level (the v0/v3 wrapping `tool-result` block is gone; content is
 * plain text blocks; the call id sits in `toolCallId` / `source.callId`).
 * Text markers still count when the flag is absent: a command exiting
 * non-zero is reported by the harness as "[exit code: N]" in the result text
 * without flipping the flag.
 */
export function toolErrorOfMessage(message) {
  if (!message || typeof message !== 'object') return 0
  if (message.isError === true) return 1
  return errorTextMatches(textOfContent(message.content)) ? 1 : 0
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
 * @returns { tier, stepClass, baseClass, reason[], poisoned }
 */
export function decideEffort(cfg, signals) {
  // Recovery path: a poisoned history must keep thinking off until compaction
  // removes the offending turn, or every thinking-enabled request fails.
  if (signals && signals.poisonedHistory) {
    return {
      tier: 'off',
      stepClass: 'standard',
      baseClass: 'standard',
      reason: ['history already contains a tool call without thinking; keeping effort off'],
      poisoned: true,
    }
  }

  const s = cfg.scoring
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
    reason,
    poisoned: false,
  }
}
