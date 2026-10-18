# Roadmap / 待推进需求

Recorded 2026-10-10, after the 0.2.0 code-review pass. Items are ordered by
the maintainer's priority; nothing here is scheduled until explicitly picked
up.

## Settled by 0.2.8 (the drift engine)

- **R5 (subagent routing) — DIRECTION SET, NOT IMPLEMENTED.** See the R5
  section: the maintainer's ruling is that subagents SHOULD be auto-routed
  (the origin classifies the spawn instruction text, an empty spawn anchors
  `standard`, and the frugal subagent demotion applies on top). Re-measured
  2026-10-18 on DSH 0.2.1-rc.2, the implementation is still missing — a live
  subagent's steps record `mode: manual`, i.e. the parent's resolved level
  arrives as a concrete seed and is passed straight through. Low priority.
- **R6 (restart replay pollution) — mitigated.** Resumed tasks now resume
  with the warm-up EXPIRED, and the error window is the `shortWindow`
  parameter (default 6) instead of a flat 32-bucket window, so the
  replayed-stale-escalation blast radius is much smaller; the residual (a
  replayed error still weighs 1 on its first bucket) self-heals within
  `shortWindow` new steps. See the R6 section.
- **Audit R4.2 (repeat threshold validity) — re-anchored.** Repeat/error
  rungs are now freshness-aware (`decayThreshold`): N events reach their
  rung at full weight only when fresh. The validity question itself moves
  to the decision log's `weightedErrors`/`weightedRepeats` fields.
- **Audit R4.3 (volume ladder recalibration) — transformed.** The two-rung
  log ladders became user-tunable LINEAR ramps (`briefRamp`/`toolRamp`)
  over gzip-discounted effective tokens; the log keeps raw + discounted
  pairs so the next calibration cycle can set rungs from data. That
  calibration has NOT been run yet — see "Deferred calibration" below.

## R1 — Tool-call captions: retired from the chat flow (DONE, 0.2.1; revived as opt-in 0.2.7-rc.7)

**Status quo.** 0.1.x annotated every tool call in the chat flow with the
`provider/model · effort` the step ran with (client surface 3:
`src/client/annotations.ts` + the host-side `effortRouterRoute` projection in
`lib/route-projection.js`). In 0.2.0 field testing the captions did not render
at all — the registration seam (`uiConversation.events.register` +
`conversation.chat.node`) apparently no longer anchors the rows, and nobody
missed them.

**Decision (maintainer, 0.2.1).** The captions are NOT wanted back in the chat
flow — keep the conversation clean.

**Decision reversed (maintainer, 0.2.7-rc.7).** As part of the
config-file-only options redesign, the surface came back as `chatAnnotate`
(DEFAULT OFF): the same event-view + `conversation.chat.node` seam, now fed by
the existing `effortRouterAnchors` session projection (no new host projection;
tool/call events anchor on the bare callId). The client reads the flag once at
load, so a toggle applies on page reload. **Open verification point:** the
0.2.0 field note said this seam rendered nothing. It was tested once around
0.2.7 and produced no rows. Static check 2026-10-18 against the running host
(0.2.1-rc.2): the `conversation.chat.node` slot DOES exist — 61 hits in
`dsh-client-ui-chat/lib/client.js`, and the registration shape this plugin uses
(`slots.inject` + `slots.register({ name, key, locale })`) matches the host's
own node views; `useProjection` is a `ChatView` prop. So the surface is
plausible and worth ONE manual look — it is not re-tested every release. If it
renders nothing, treat it as a host-seam question, not a plugin bug. Tracked in
`MAINTAINER-TESTS.md`, which is the running list of things only the maintainer
can confirm on a major upgrade.

**0.2.1 removal (superseded).** Removed the chat-annotation surface:
`annotations.ts`, surface 3 in `src/client/index.tsx`, the `.er-call*` styles,
the `annotation.default` locale keys, the host-side `effortRouterRoute`
projection + its registration (`lib/route-projection.js`), the
`dsh-client-ui-conversation` inject/peer entries, and the README bullets.
The per-step effort remains stamped on every `request/header` session event
(`config.reasoningEffort`), which is the event stream the trajectory view is
built from.

**Follow-up verification (maintainer, 2026-10-11):** the host's trajectory view
does NOT render `request/header` payloads — per-step effort is not visible
there. That is a host-side presentation gap (no plugin-side trace seam is
known); the plugin-side fallback is R4.

## R4 — Trajectory effort visibility (DONE, 0.2.1→0.2.2)

**Context.** R1 retired the chat-flow captions on the understanding that the
trajectory view would show per-step effort; the host renders `request/header`
payloads only inside the per-request inspector (请求计时 → 选项), not on the
default ledger rows (verified 2026-10-11).

**Implemented (0.2.2): trajectory hoisting, NOT a panel.** The maintainer
supplied community reference routes (2026-10-11); the plugin took the
`dsh-trajectory-zh` route — an assembly-layer client bundle + a
MutationObserver DOM projection on the native trajectory tab, touching no
host package and adding no view:

- Host: a new `effortRouterAnchors` session projection folds
  `request/header` + `assistant/message` (message.id) + `tool/call` (callId)
  into an anchor → provider/model/effort table (500/session cap), served on
  the existing read-only state route.
- Client: `src/client/trajectory.ts` watches the trajectory ledger and
  decorates rows keyed by `data-trajectory-row-key` (`tool\0call\0<callId>`
  for tool rows, the message recordId for assistant rows) with a compact
  `provider/model · effort` caption. Idempotent, debounced, no-op outside
  the trajectory tab or when `trajectoryAnnotate` is off.

Earlier panel-placement proposal (badge popup / dock card / settings
section): superseded — no new surface was needed after all.

## R2 — Poison detection: provenance-gated pin (DONE, 0.2.1)

**Problem.** The 0.2.0 continuity guard (`toolCallWithoutReasoning`) inferred
"this assistant turn ran with thinking off" from the ABSENCE of a reasoning
block on a tool-call message. That inference is unsound for routes that do
not persist reasoning blocks per step — and it fired on the common case:

- **Measured 2026-10-10** (session `eb12fb23`, kimi-K3 @ `low`, explicitly
  asked to think): turn 1 step 1 carried a 424-char reasoning block, step 2
  carried a tool call with NO reasoning block, step 3 reasoned again. Same
  model, same effort, thinking ON the whole time. The 0.2.0 rule read step 2
  as poison and would have pinned Auto to `off` forever. (deepseek-flash @
  `high` in the same session emitted a `reasoning(0)` empty block — presence,
  not content, is what the old heuristic read.)
- The strict-API problem the guard exists for is real on other models: on
  thinking-mode APIs that reject mixed histories, an actual off turn carrying
  a tool call does poison every later thinking-enabled request.

**Implemented design.** Shape is now only a SUSPECT fact, never a verdict:

1. `signals` exposes `offShapeHistory` — "a reasoning-less tool-call turn
   exists in history" (the payload shape a strict API would choke on).
2. The host pins `off` only when shape is backed by decision-store
   PROVENANCE: a recorded step in this session with `mode: 'manual'` and
   `effort: 'off'` (`storeProvenManualOff`). Auto never routes off (rule 4),
   so only an explicit human off pick can arm the pin; K3-style auto sessions
   never carry such a record and can never be pinned.
3. The pin bypasses hysteresis (a 0.2.0 bug routed the pin through
   `stabilizeEffort`, which held the previous thinking-on tier for `downAfter`
   steps — sending exactly the request the pin exists to prevent).
4. The pin still lifts on compaction (the shape flag is re-derived on
   projection shrink), and a new `poisonRecovery` switch (default on) lets
   users on provably non-strict routes disable it.

**Known residual (accepted, documented in code):** provenance does not tie the
manual-off STEP to the tool-call MESSAGE (at request time the step's own tool
calls do not exist yet). A manual off pick whose step made NO tool calls,
followed by auto routing on a K3-style model, still pins off until compaction
or manual override. Rare, reversible, and strictly better than the 0.2.0
false-positive-on-every-K3-tool-loop; refining it needs lazy
record↔message association and is not currently worth the plumbing.

## R3 — (done in the 0.2.0 review pass) README badge position

The READMEs said the composer badge sits right of the model selector; it
actually sits left. Doc-only fix, applied to `README.md` and `README.zh.md`
in the 0.2.0 review pass.

## R5 — Subagent auto-routing (NOT IMPLEMENTED; direction: do it, low priority)

**Status.** Planned, accepted as the direction, not scheduled, not built.
Until it lands, a subagent request inherits whatever level the parent's step
carried: the plugin passes it through as if a human had picked it. Do not read
that as the ruling — the ruling is that subagents SHOULD be auto-routed.

**Evidence (re-measured 2026-10-18, DSH 0.2.1-rc.2).** A live subagent spawn
recorded `mode: manual, effort: low, tier: null` on every step. The parent's
resolved `low` arrives as a concrete seed; a fresh subagent session has no
decision-store history, so the echo guard has nothing to compare against, and
the concrete level reads as a human pick and is passed through verbatim.
Consequences on 0.2.1-rc.2:

- `subagentEffort` never fires (it only fills a request with NO effort);
- the frugal "subagent" demotion never fires (the interceptor returns at the
  manual pass-through before the signal collector runs);
- `subagentPreferCheap` was removed from the policy in the cleanup pass — it
  never had a config key, so the branch was unconditionally on and unreachable
  anyway.

**Candidate fixes (pick one when this is scheduled):**

(a) provenance heuristic — treat a concrete seed as an echo when
    `header.delegationDepth > 0` AND the decision store proves the level
    equals the parent's last scheduled effort (the child knows its parent via
    `agent.parentAgent`); then schedule normally and let the frugal subagent
    demotion apply. This is an inference, which is exactly what this project
    otherwise avoids, so it needs a tight condition and a test.
(b) host-side delegation provenance — an explicit marker on subagent seeds.
    Clean, upstream, not ours to land.

**When it lands:** expose `subagentPreferCheap` as a real config key, and add
the missing test (the subagent branch is currently covered only for a request
that carries NO effort).

## R6 — Evidence-window pollution after a host restart (mitigated; residual accepted)

**Observation (evidence, 2026-10-13, pre-0.2.8 engine).** After a DSH restart
the in-memory per-agent signal state is empty; the first collect of a resumed
session replays the whole projection from watermark 0, folding historical tool
errors into the sliding window. A resumed session's first steps therefore
carry stale escalations (measured then: `windowErrors=5 → escalated on
evidence x2` on the first post-restart steps of session `53eaf0fb`, all from
pre-restart failures).

**Current shape (0.2.8+).** The window lengths are CONFIG PARAMETERS, not
constants: `shortWindow` (default 6) decay-weighted error buckets under
`errorDecay`, `longWindow` (default 32) for the volume channel, and
`warmUpSteps` (default 3) for the origin floor. Mitigations in place: a
resumed task opens with its warm-up EXPIRED, and the short window keeps only
`shortWindow` buckets instead of the old flat 32 — a replayed error reaches
one bucket, weighs 1, and ages out within `shortWindow` new steps. The
compaction channel's own scan reads `session.snapshotEvents()` and is skipped
whole while `compactionBump` is off (cleanup pass), which also bounds the
per-step cost of a long log.

**Residual (accepted).** A replayed error still weighs 1 in its first bucket,
so the first steps after a restart can sit one class high. Options if it ever
matters: persist the watermark with the decision store, or stamp evidence with
wall-clock age and discount old buckets.

## Deferred calibration (the "next cycle" work, still open)

The audit research (`T4`/`T6`, machine-local notes under `docs/`) deferred two
things to "the next cycle"; neither has been run. The decision log has carried
the fields needed since 0.2.8, so both are executable whenever picked up:

- **Volume-ramp re-anchoring (audit R4.3/R4.7).** `briefRamp` and `toolRamp`
  were left at their provisional values pending real runtime distribution.
  A first look at the local decision log (2026-10-18, 453 samples carrying the
  observation fields): `briefVolume` p50≈123 / p95≈7,079 (rung 1 `>400` fires
  23.3%, rung 2 `>1600` fires 6.3%), while `toolVolume` p50≈3,114 / p99≈23,726
  / max≈23,816 — i.e. `toolRamp: 48000,128000` NEVER fires (0.0% at both
  rungs), so half of channel ② is inert in practice. Decide: lower the tool
  rungs toward the observed range, or keep them deliberately for the big-result
  tail and say so.
- **Dictionary change shadow run (T6 §6.1).** The 0.2.6/0.2.7 dictionary moves
  were applied directly; the agreed "shadow first, review flip rates after one
  cycle" step was never run, and the observation list (方法/具体/参考/读取/
  资料/获取/项目/你是/代理) plus the zero-hit pruning rule still await a ruling.
  See `docs/ops/t6-dictionary-full-recommendations.md` §6.
