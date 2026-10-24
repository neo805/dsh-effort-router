/**
 * signals.js tests with a synthetic agent/session — the 0.2.8 drift engine:
 * origin anchor (classified once), warm-up floor + merge rule, epoch-scoped
 * short window (decay-weighted errors/repeats, todo bump, carry), the
 * long volume window across task boundaries, and the gzip-ratio discount.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSignals } from '../lib/signals.js'
import { decideEffort, normalizePolicyConfig } from '../lib/policy.js'

const silentLogger = { info() {}, warn() {} }

function makeAgent(messages) {
  return {
    sessionId: 's1',
    session: {
      id: 's1',
      header: {},
      deriveMessages: () => messages,
    },
  }
}

function makeSignals(cfg = {}, extra = {}) {
  return createSignals({
    config: () => normalizePolicyConfig(cfg),
    logger: silentLogger,
    projections: extra.projections,
    compress: extra.compress,
  })
}

const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistantCall = (name, args = '{}') => ({
  role: 'assistant',
  content: [{ type: 'reasoning', text: 'thinking' }, { type: 'tool-call', name, arguments: args }],
})
const toolResult = (text, isError = false) => ({
  role: 'user',
  content: [{ type: 'tool-result', content: [{ type: 'text', text }], isError }],
})
/** DSH v4 shape: first-class role:"tool" message (verified against the host's own construction). */
const v4ToolResult = (text, isError = false, callId = 'c1') => ({
  role: 'tool',
  toolCallId: callId,
  isError,
  source: { kind: 'tool', callId },
  content: [{ type: 'text', text }],
})

/** A script of n failing/clean call+result pairs (v4). */
function script(pairs) {
  const out = []
  let i = 0
  for (const [name, text, isError] of pairs) {
    i += 1
    out.push(assistantCall(name, '{"p":' + i + '}'), v4ToolResult(text, isError, 'c' + i))
  }
  return out
}

// ---- channel ④ origin anchor ------------------------------------------------

test('origin: the claimed brief is classified ONCE and anchors the task', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.originClass, 'engineering')
  assert.equal(sig.warmup, true, 'a fresh task is inside its warm-up')
  assert.ok(sig.briefTokens > 0, 'brief token estimate is exposed')
  // Later steps never re-classify: the projection's last user text changes
  // (a cheap-looking follow-up the claim stream announced long ago), the
  // origin stays put.
  agent.session.deriveMessages = () => [userMsg('帮我重构这个模块的缓存'), userMsg('哦')]
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.originClass, 'engineering')
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'engineering')
  assert.equal(d.tier, 'high')
})

test('origin: an empty brief (subagent spawn fallback) anchors standard', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  agent.session.header = { delegationDepth: 1 }
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.originClass, 'standard', 'the approved subagent default')
  assert.equal(sig.frugal, true)
  assert.equal(sig.frugalWhy, 'subagent')
})

test('origin: a task with work already under it resumes with the warm-up EXPIRED', () => {
  const signals = makeSignals()
  // Resumed window: the instruction is followed by the work it triggered —
  // its age is undatable, so it gets no floor. A bare instruction with no
  // work yet is, for all the engine knows, fresh and DOES warm up.
  const agent = makeAgent([userMsg('帮我重构这个模块的缓存'), assistantCall('read', '{"p":"a"}')])
  const sig = signals.collect(agent, { turn: 3, step: 1 })
  assert.equal(sig.originClass, 'engineering')
  assert.equal(sig.warmup, false, 'an undated task gets no floor')
})

test('warm-up floor: frugal cannot undercut the origin while the task is fresh', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  agent.session.header = { delegationDepth: 1 } // frugal: subagent
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  const cfg = normalizePolicyConfig({})
  // warmUpSteps 3: the first three steps hold the origin class...
  for (let step = 1; step <= 3; step += 1) {
    const sig = signals.collect(agent, { turn: 1, step })
    assert.equal(sig.warmup, true, 'step ' + step + ' is inside the warm-up')
    const d = decideEffort(cfg, sig)
    assert.equal(d.stepClass, 'engineering', 'frugal is floored at step ' + step)
    assert.ok(d.reason.join().includes('warm-up'))
  }
  // ...the fourth step drifts below the origin: aggressive saving in action.
  const sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.warmup, false)
  const d = decideEffort(cfg, sig)
  assert.equal(d.stepClass, 'standard', 'after the warm-up, drift owns the level')
})

test('merge rule: a follow-up inside the warm-up keeps the STRONGER origin and restarts it', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('今天天气怎么样'), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  // Interjection one step later: same task — the stronger origin wins.
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 2 })
  let sig = signals.collect(agent, { turn: 2, step: 1 })
  assert.equal(sig.originClass, 'engineering', 'the merged task takes the stronger origin')
  assert.equal(sig.warmup, true, 'the warm-up restarted')
  // A follow-up BEYOND the warm-up opens a new task with its own origin.
  signals.collect(agent, { turn: 2, step: 2 })
  signals.collect(agent, { turn: 2, step: 3 })
  signals.collect(agent, { turn: 2, step: 4 })
  signals.onClaimed({ agent, message: userMsg('今天天气怎么样'), turn: 3 })
  sig = signals.collect(agent, { turn: 3, step: 1 })
  assert.equal(sig.originClass, 'standard', 'a real boundary classifies a fresh origin')
  assert.equal(sig.carry, 0)
})

test('an unannounced user message in the projection opens a task synthetically', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('今天天气怎么样'), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  // The host never emitted claimed for this interjection; the projection shows it.
  agent.session.deriveMessages = () => [userMsg('今天天气怎么样'), userMsg('帮我重构这个模块的缓存')]
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.originClass, 'engineering', 'synthetic claim classified the interjection')
})

// ---- channel ① short window --------------------------------------------------

test('errors fold into the short window; the FIRST one lifts (0.2.6, audit R4.1)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => script([
    ['read', '[exit code: 1] boom', true],
    ['read', '[exit code: 2] boom again', true],
  ])
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 2)
  assert.equal(sig.weightedErrors, 1 + 0.8, 'newest bucket weighs 1, the previous 0.8')
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'hard', 'standard +2 -> hard')
})

test('decay weights: a stale error alone cannot reach the threshold', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => script([
    ['read', '[exit code: 1] boom', true], // age 1 -> weight 0.8 < escalateOnErrors(1)
    ['read', 'ok', false],
  ])
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.taskErrors, 1, 'the raw count still logs')
  assert.equal(sig.weightedErrors, 0.8)
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'standard', 'no fresh evidence: no lift')
})

test('the short window ages evidence out after shortWindow buckets', () => {
  const signals = makeSignals({ shortWindow: 3 })
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => script([
    ['read', '[exit code: 1] boom', true], // 4 buckets back in a 3-bucket window
    ['read', 'ok', false],
    ['read', 'ok', false],
    ['read', 'ok', false],
  ])
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.taskErrors, 0, 'the error aged out of the short window')
  assert.equal(sig.toolCalls, 4, 'the long window still counts every call')
  assert.ok(sig.toolVolume > 0, 'and still sums the volume')
})

test('a real task boundary zeroes the short window but carries unresolved errors', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('任务一'), turn: 1 })
  agent.session.deriveMessages = () => script([
    ['bash', '[exit code: 9] fail', true],
    ['bash', '[exit code: 9] fail again', true],
  ])
  signals.collect(agent, { turn: 1, step: 2 })
  // Boundary beyond the warm-up: new epoch.
  for (let step = 3; step <= 5; step += 1) signals.collect(agent, { turn: 1, step })
  const volumeBefore = signals.collect(agent, { turn: 1, step: 6 }).toolVolume
  signals.onClaimed({ agent, message: userMsg('任务二'), turn: 2 })
  const sig = signals.collect(agent, { turn: 2, step: 1 })
  assert.equal(sig.taskErrors, 0, 'the new task starts from zero error evidence')
  assert.equal(sig.carry, 1, 'the unresolved failure of the previous task carries +1')
  assert.equal(sig.toolVolume, volumeBefore, 'the long volume window spans the boundary')
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'engineering', 'standard +1 carry -> engineering')
})

test('carry decays with the short window', () => {
  const signals = makeSignals({ shortWindow: 3 })
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('任务一'), turn: 1 })
  agent.session.deriveMessages = () => script([['bash', '[exit code: 9] fail', true]])
  signals.collect(agent, { turn: 1, step: 2 })
  for (let step = 3; step <= 5; step += 1) signals.collect(agent, { turn: 1, step })
  signals.onClaimed({ agent, message: userMsg('任务二'), turn: 2 })
  let sig = signals.collect(agent, { turn: 2, step: 1 })
  assert.equal(sig.carry, 1)
  sig = signals.collect(agent, { turn: 2, step: 2 })
  sig = signals.collect(agent, { turn: 2, step: 3 })
  sig = signals.collect(agent, { turn: 2, step: 4 })
  assert.equal(sig.carry, 0, 'carry is a short-window signal, not a permanent bias')
})

test('repeated identical tool calls count inside the short window', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('检查'), turn: 1 })
  const same = JSON.stringify({ p: 'same' })
  agent.session.deriveMessages = () => [
    assistantCall('read', same),
    toolResult('ok'),
    assistantCall('read', same),
    toolResult('ok'),
    assistantCall('read', same),
    toolResult('ok'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.taskRepeats, 2)
  assert.ok(sig.weightedRepeats > 0 && sig.weightedRepeats < 2, 'repeats are decay-weighted too')
})

test('todo completion bumps +1 inside the short window', () => {
  let todos = [
    { status: 'in_progress', content: '实现缓存层' },
    { status: 'pending', content: '补测试' },
  ]
  const projections = { stateOf: (_s, key) => (key === 'todos' ? todos : undefined) }
  const signals = makeSignals({}, { projections })
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.todoBump, 0, 'the first snapshot only primes the diff')
  // One completion fires the bump...
  todos = [
    { status: 'completed', content: '实现缓存层' },
    { status: 'in_progress', content: '补测试' },
  ]
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.todoBump, 1)
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'hard', 'engineering +1 todo -> hard')
  // ...two completions in ONE step still fire a single bump...
  todos = [
    { status: 'completed', content: '实现缓存层' },
    { status: 'completed', content: '补测试' },
  ]
  sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.todoBump, 1, 'several completions, one bump')
})

test('a wholesale todo-list rewrite is NOT a completion (no content lineage)', () => {
  let todos = [{ status: 'in_progress', content: '实现缓存层' }]
  const projections = { stateOf: (_s, key) => (key === 'todos' ? todos : undefined) }
  const signals = makeSignals({}, { projections })
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  // The model rewrote the plan: no content matches, so nothing can have
  // observably "completed" — the conservative reading is no bump.
  todos = [{ status: 'completed', content: '全新的事项' }]
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.todoBump, 0, 'a rewritten list proves nothing')
})

// ---- synthetic user-role inserts are NOT briefs (0.2.1) ----------------------

const sourcedUser = (text, source) => ({ role: 'user', content: [{ type: 'text', text }], source })

test('a runtime-context snapshot neither opens a task nor restarts the warm-up', () => {
  const signals = makeSignals()
  const messages = [sourcedUser('帮我重构这个模块的缓存', { kind: 'user' })]
  const agent = makeAgent(messages)
  const sig1 = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig1.originClass, 'engineering')
  assert.equal(sig1.warmup, true)
  // 0.2.1 inserts this as a user-role message; it must not be read as a brief.
  messages.push(sourcedUser(
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots. '
    + '工具调用 文件 仓库 测试 重构',
    { kind: 'runtime-context', form: 'snapshot' },
  ))
  signals.collect(agent, { turn: 1, step: 2 }) // tick 2: still inside the window
  signals.collect(agent, { turn: 1, step: 3 }) // tick 3
  const sig4 = signals.collect(agent, { turn: 1, step: 4 }) // tick 4 = past it
  assert.equal(sig4.originClass, 'engineering', 'the origin anchor survives the snapshot')
  assert.equal(sig4.warmup, false, 'no warm-up restart: tick 4 is past the fresh-task window')
  // With the phantom-task bug this collect would still be warming up (the
  // snapshot at tick 2 would have restarted the window: 4 - 2 <= 3).
})

test('a checkpoint / skill catalog / model-switch notice is not a brief either', () => {
  const signals = makeSignals()
  const messages = [sourcedUser('翻译这句话', { kind: 'user' })]
  const agent = makeAgent(messages)
  const sig1 = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig1.originClass, 'trivial')
  messages.push(
    sourcedUser('[Model-written summary] 全部重构完成，工程改造已落地', { kind: 'compact-checkpoint' }),
    sourcedUser('Skill catalog: skill-a skill-b', { kind: 'skill-catalog', form: 'catalog' }),
    sourcedUser('[model changed: kimi-k3 → deepseek-flash]', { kind: 'model-selection', form: 'notice' }),
  )
  const sig2 = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig2.originClass, 'trivial', 'notices never re-classify the origin')
})

test('a settlement notice counts as the orchestration RETURN (0.2.9 channel ①)', () => {
  const signals = makeSignals()
  const messages = [sourcedUser('帮我重构这个模块的缓存', { kind: 'user' })]
  const agent = makeAgent(messages)
  const sig1 = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig1.subagentReturn, 0)
  messages.push(sourcedUser(
    'Background subagent 123 finished. Its closing message: 工程改造完成',
    { kind: 'subagent-settled', form: 'notice' },
  ))
  const sig3 = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig3.subagentReturn, 1, 'the parent integrates the returned result')
  assert.equal(sig3.originClass, 'engineering', 'and the notice did not become a brief')
})

test('a sourceless legacy user message still opens a task (v0/v3 replays)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  const sig1 = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig1.originClass, 'standard', 'empty session anchors standard')
  agent.session.deriveMessages = () => [userMsg('帮我重构这个模块的缓存')]
  const sig2 = signals.collect(agent, { turn: 2, step: 1 })
  assert.equal(sig2.originClass, 'engineering', 'no source marker = accepted as a brief')
})

// ---- channel ① event bumps: subagent return + compaction (0.2.9) --------------

test('a subagent return bumps +1 inside the short window, then decays', () => {
  const signals = makeSignals()
  const messages = []
  const agent = makeAgent(messages)
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.subagentReturn, 0)
  // The assistant fans a task out; the child's result lands in the parent.
  messages.push(assistantCall('subagent', '{"task":"a"}'), v4ToolResult('child done', false, 'c1'))
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.subagentReturn, 1, 'the integrating step reads the return')
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'hard', 'engineering +1 subagent return -> hard')
  // The bump ages out with the short window (event tick 1, shortWindow 6:
  // holds while tick - 1 < 6, i.e. through step 6, gone from step 7).
  for (let step = 3; step <= 6; step += 1) {
    sig = signals.collect(agent, { turn: 1, step })
    assert.equal(sig.subagentReturn, 1, 'still inside the window at step ' + step)
  }
  sig = signals.collect(agent, { turn: 1, step: 7 })
  assert.equal(sig.subagentReturn, 0, 'aged out beyond the window')
})

test('a plain tool result is NOT a subagent return', () => {
  const signals = makeSignals()
  const messages = []
  const agent = makeAgent(messages)
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  messages.push(assistantCall('read', '{"p":"a"}'), v4ToolResult('file body', false, 'c1'))
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.subagentReturn, 0)
})

test('a compaction checkpoint bumps +1 (snapshotEvents scan, engine-agnostic)', () => {
  const signals = makeSignals()
  const events = []
  const agent = makeAgent([])
  agent.session.snapshotEvents = () => events
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.compaction, 0)
  // An unrelated user/message event is not a checkpoint.
  events.push({ type: 'user/message', data: { source: { plugin: 'acp-nudge' } } })
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.compaction, 0)
  // The shared checkpoint marker (compaction-basic AND ACP land this shape).
  events.push({ type: 'user/message', data: { source: { plugin: 'compact', compactionId: 'k1' } } })
  sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.compaction, 1)
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.stepClass, 'hard', 'engineering +1 compaction -> hard')
  // The lifecycle event fires too (kind variant also matches).
  events.push({ type: 'compaction/end', data: { compactionId: 'k2' } })
  sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.compaction, 1)
})

test('no snapshotEvents surface: the compaction channel degrades silently', () => {
  const signals = makeSignals()
  const agent = makeAgent([]) // session without snapshotEvents (design rule 1)
  signals.onClaimed({ agent, message: userMsg('帮我重构这个模块的缓存'), turn: 1 })
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.compaction, 0, 'a missing event surface reads as no signal, never a crash')
})

// ---- channel ② long window + compression discount ----------------------------

test('the volume ramps read effective (discounted) tokens', () => {
  // Fake compressor: everything measures at 20% — repetition-heavy results.
  const compress = { ratio: (pieces) => (pieces.join('').length >= 256 ? { bytes: 1000, gzBytes: 200, ratio: 0.2 } : null) }
  const signals = makeSignals({}, { compress })
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  // tokenEstimate counts latin RUNS: vary the words so 5 words x 240
  // repetitions count ~1200 tokens, not ~240.
  const big = Array.from({ length: 240 }, (_, i) => 'lorem ipsum dolor sit amet' + i).join(' ')
  agent.session.deriveMessages = () => script([['read', big, false]])
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.ok(sig.toolVolumeRaw > 1000, 'raw volume reflects the text')
  assert.ok(sig.toolVolume < sig.toolVolumeRaw / 2, 'the discounted volume is much smaller')
})

test('no compressor wired = raw tokens (the pre-0.2.8 behavior)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => script([['read', 'x'.repeat(4000), false]])
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolVolume, sig.toolVolumeRaw)
})

test('brief entries accumulate over the long window into the brief ramp', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('翻译 ' + 'word '.repeat(250)), turn: 1 })
  signals.collect(agent, { turn: 1, step: 1 })
  // A merged follow-up adds MORE brief information to the same window.
  signals.onClaimed({ agent, message: userMsg('还有 ' + 'word '.repeat(250)), turn: 2 })
  const sig = signals.collect(agent, { turn: 2, step: 1 })
  assert.ok(sig.briefVolume > 400, 'both briefs sum into the long window')
  assert.ok(sig.briefVolumeRaw >= sig.briefVolume)
})

// ---- the rest of the collector contract --------------------------------------

test('off-shape history is detected and cleared after a shrink (shape fact, not poison)', () => {
  const signals = makeSignals()
  const agent = makeAgent([
    userMsg('do something'),
    { role: 'assistant', content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] }, // no reasoning block
  ])
  let sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.offShapeHistory, true)
  // compaction summarizes the offending turn away: the projection SHRINKS
  agent.session.deriveMessages = () => [userMsg('summary')]
  sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.offShapeHistory, false)
})

test('off shape alone does NOT poison the decision (the kimi-K3 false positive)', () => {
  // K3 with thinking ON emits no reasoning block before a tool call. decideEffort
  // only reads caller-PROVEN poison (signals.poisonedHistory), which the host
  // sets from shape + store provenance — a bare offShapeHistory never pins off.
  const signals = makeSignals()
  const agent = makeAgent([
    userMsg('do something'),
    { role: 'assistant', content: [{ type: 'tool-call', name: 'calculator', arguments: '{}' }] },
  ])
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.offShapeHistory, true)
  const d = decideEffort(normalizePolicyConfig({}), sig)
  assert.equal(d.poisoned, false)
  assert.notEqual(d.tier, 'off')
})

test('loud degradation: missing deriveMessages warns once and still classifies the brief', () => {
  const warnings = []
  const signals = createSignals({
    config: () => normalizePolicyConfig({}),
    logger: { info() {}, warn: (m) => warnings.push(m) },
    projections: undefined,
  })
  const agent = { sessionId: 's2', session: { id: 's2' } }
  signals.onClaimed({ agent, message: userMsg('重构缓存'), turn: 1 })
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.toolCalls, 0)
  assert.equal(sig.originClass, 'engineering') // brief still drives the origin
  signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(warnings.filter((w) => w.includes('deriveMessages')).length, 1) // warned exactly once
})

test('projection signals: pressure above threshold marks frugal', () => {
  const projections = {
    stateOf: (_session, key) => {
      if (key === 'contextPressure') return { contextWindow: 100, pressureTokens: 90 }
      return undefined
    },
  }
  const signals = createSignals({
    config: () => normalizePolicyConfig({ contextPressure: 0.75 }),
    logger: silentLogger,
    projections,
  })
  const agent = makeAgent([])
  const sig = signals.collect(agent, { turn: 1, step: 1 })
  assert.equal(sig.frugal, true)
  assert.ok(sig.frugalWhy.includes('context pressure'))
})

test('v4 tool channel: message-level isError folds into the window (audit R1)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看这些文件'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    v4ToolResult('Error: boom', true, 'c1'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.equal(sig.toolCalls, 1)
  assert.equal(sig.taskErrors, 1, 'v4 message-level isError counts')
  assert.equal(sig.weightedErrors, 1, 'the newest bucket weighs 1')
  assert.ok(sig.toolVolume > 0, 'v4 text blocks count toward result volume')
})

test('v4 tool channel: exit-code text counts without the flag; clean results do not', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('跑一下'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('pwsh', '{"command":"a"}'),
    v4ToolResult('done\n[exit code: 1]', false, 'c1'), // flag false but text reports failure
    assistantCall('pwsh', '{"command":"b"}'),
    v4ToolResult('all good', false, 'c2'), // no marker at all
  ]
  const sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 1, 'only the exit-code result counts')
})

test('error sources are counted for the decision log', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('排查这个脚本的失败'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('a', '{"p":1}'), v4ToolResult('', true, 'c1'),
    assistantCall('b', '{"p":2}'), v4ToolResult('[exit code: 2]', false, 'c2'),
    assistantCall('c', '{"p":3}'), v4ToolResult('ok', false, 'c3'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 2 })
  assert.deepEqual(sig.errorSources, { isError: 1, 'exit-bracket': 1 })
  assert.equal(typeof sig.sessionTokens, 'number', 'raw telemetry is available to the decision log')
})

test('mixed v4 + v0/v3 history folds each result exactly once', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('看看'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    v4ToolResult('Error: boom', true, 'c1'), // v4
    assistantCall('read', '{"p":"b"}'),
    toolResult('[exit code: 1] bam', false), // v0/v3 wrapper
  ]
  const sig = signals.collect(agent, { turn: 1, step: 3 })
  assert.equal(sig.toolCalls, 2)
  assert.equal(sig.taskErrors, 2, 'one error per result, no double counting')
})

test('consecSameTool observes the trailing identical-tool run (no decision use)', () => {
  const signals = makeSignals()
  const agent = makeAgent([])
  signals.onClaimed({ agent, message: userMsg('检查'), turn: 1 })
  agent.session.deriveMessages = () => [
    assistantCall('read', '{"p":"a"}'),
    v4ToolResult('ok', false, 'c1'),
    assistantCall('read', '{"p":"b"}'),
    v4ToolResult('ok', false, 'c2'),
    assistantCall('pwsh', '{"command":"x"}'),
    v4ToolResult('ok', false, 'c3'),
  ]
  const sig = signals.collect(agent, { turn: 1, step: 4 })
  assert.equal(sig.consecSameTool, 1, 'last call was pwsh, breaking the read run')
})

// ---- cleanup-pass coverage: resumed-window anchor, budget, disabled channel --

test('origin: a resumed window anchors on the last GENUINE user text (notices are skipped)', () => {
  const signals = makeSignals()
  const messages = [
    // The projection opens mid-task: a tool result, then a synthetic notice.
    { role: 'user', content: [{ type: 'tool-result', content: [{ type: 'text', text: '翻译这句话' }] }] },
    { role: 'user', content: [{ type: 'text', text: '帮我重构整个分布式架构' }], source: { form: 'notice', kind: 'runtime-context' } },
  ]
  const sig = signals.collect(makeAgent(messages), { turn: 1, step: 1 })
  assert.equal(sig.originClass, 'trivial', 'the notice text is not a brief — the tool-result text anchors instead')
  assert.equal(sig.warmup, false, 'a resumed task starts with its warm-up already expired')
})

test('frugal: the session token budget fires once the projection total crosses it', () => {
  const projections = {
    stateOf: (_session, key) => (key === 'tokenUsage' ? { totals: { input: 900, output: 200 } } : undefined),
  }
  const over = makeSignals({ sessionTokenBudget: 1000 }, { projections })
  const sig = over.collect(makeAgent([]), { turn: 1, step: 1 })
  assert.equal(sig.frugal, true)
  assert.equal(sig.frugalWhy, 'session token budget')

  // 0 means off; a total below the budget is not frugal either.
  const off = makeSignals({ sessionTokenBudget: 0 }, { projections })
  assert.equal(off.collect(makeAgent([]), { turn: 1, step: 1 }).frugal, false)
  const under = makeSignals({ sessionTokenBudget: 5000 }, { projections })
  assert.equal(under.collect(makeAgent([]), { turn: 1, step: 1 }).frugal, false)
})

test('compactionBump=false never materializes the event log; re-enabling re-anchors', () => {
  let cfg = normalizePolicyConfig({ compactionBump: false })
  const fromSeqCalls = []
  const events = []
  const agent = makeAgent([])
  Object.defineProperty(agent.session, 'seq', { get: () => events.length })
  agent.session.snapshotEvents = (fromSeq = 0) => {
    fromSeqCalls.push(fromSeq)
    return events.slice(fromSeq)
  }
  const signals = createSignals({ config: () => cfg, logger: silentLogger })

  assert.equal(signals.collect(agent, { turn: 1, step: 1 }).compaction, 0)
  assert.equal(fromSeqCalls.length, 0, 'a disabled channel pays nothing per step')

  // A checkpoint lands while the channel is off: enabling it again must adopt
  // the current log as the BASELINE, not replay it as fresh evidence.
  events.push({ type: 'compaction/end', data: {} })
  cfg = normalizePolicyConfig({ compactionBump: true })
  assert.equal(signals.collect(agent, { turn: 1, step: 2 }).compaction, 0)
  assert.equal(fromSeqCalls.length, 0, 're-anchor reads session.seq, not the whole log')

  // A checkpoint AFTER the baseline is real evidence again.
  events.push({ type: 'compaction/end', data: {} })
  assert.equal(signals.collect(agent, { turn: 1, step: 3 }).compaction, 1)
  assert.deepEqual(fromSeqCalls, [1], 'only the unseen tail is materialized')
})

test('compaction scan reads only the suffix after the watermark', () => {
  const events = [{ type: 'step/end', data: { i: 0 } }, { type: 'step/end', data: { i: 1 } }]
  const fromSeq = []
  const agent = makeAgent([])
  Object.defineProperty(agent.session, 'seq', { get: () => events.length })
  agent.session.snapshotEvents = (start = 0) => {
    fromSeq.push(start)
    return events.slice(start)
  }
  const signals = makeSignals()
  signals.collect(agent, { turn: 1, step: 1 })
  events.push({ type: 'compaction/end', data: {} })
  assert.equal(signals.collect(agent, { turn: 1, step: 2 }).compaction, 1)
  assert.deepEqual(fromSeq, [0, 2], 'the second scan starts at the old log end')
})

test('todoBump disabled then enabled does not replay completions from the off period', () => {
  let cfg = normalizePolicyConfig({ todoBump: true })
  const todos = [{ content: 'step one', status: 'in_progress' }]
  const projections = {
    stateOf: (_session, key) => (key === 'todos' ? todos : undefined),
  }
  const signals = createSignals({ config: () => cfg, projections, logger: silentLogger })
  const agent = makeAgent([])
  assert.equal(signals.collect(agent, { turn: 1, step: 1 }).todoBump, 0, 'prime the in-progress snapshot')

  cfg = normalizePolicyConfig({ todoBump: false })
  todos[0] = { content: 'step one', status: 'completed' }
  assert.equal(signals.collect(agent, { turn: 1, step: 2 }).todoBump, 0)

  cfg = normalizePolicyConfig({ todoBump: true })
  assert.equal(signals.collect(agent, { turn: 1, step: 3 }).todoBump, 0, 'the first snapshot after re-enable only primes')
  todos.push({ content: 'step two', status: 'in_progress' })
  assert.equal(signals.collect(agent, { turn: 1, step: 4 }).todoBump, 0)
  todos[1] = { content: 'step two', status: 'completed' }
  assert.equal(signals.collect(agent, { turn: 1, step: 5 }).todoBump, 1, 'a real transition after priming still fires')
})

test('the long window is a bounded ring: aged buckets leave every counter', () => {
  // 10 identical calls into a 4-bucket ring: the oldest buckets are evicted, so
  // both the call count and the repeat memory must reflect only what is kept.
  const signals = makeSignals({ longWindow: 4, shortWindow: 4 })
  const messages = []
  for (let i = 0; i < 10; i += 1) {
    messages.push(assistantCall('same-tool', '{"p":1}'), v4ToolResult('ok', false, 'c' + i))
  }
  const sig = signals.collect(makeAgent(messages), { turn: 1, step: 1 })
  assert.equal(sig.toolCalls, 4, 'only the newest longWindow buckets are retained')
  assert.equal(sig.taskRepeats, 4, 'the newest 4 buckets each saw the key before, the evicted ones do not count')
})
