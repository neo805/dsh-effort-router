# Roadmap / 待推进需求

Recorded 2026-10-10, after the 0.2.0 code-review pass. Items are ordered by
the maintainer's priority; nothing here is scheduled until explicitly picked
up.

## 0.2.15-rc.5 — rc.4 review fixes (LANDED)

The rc.4 audit's high/medium findings are fixed and covered by the regression
suite: parallel tool results share one assistant-call bucket; the Auto sentinel
is excluded from concrete mapping and stripped on every fail-open path; manual
off poison provenance survives the 20-decision ring and clears with the shape;
transient capability failures are retried; removed adapters are released on
churn; long-window repeat keys retain only a SHA-256 digest; and the Badge no
longer displays a target tier as the running effort. Test baseline 194/194.

**Still open:** `gzipSync` on large tool results is synchronous. A byte cap is
simple but changes the volume channel's semantics; async zlib preserves values
but needs an ordered collect design. Do not fold either into a pure refactor.

## Settled by 0.2.8 (the drift engine)

- **R5 (subagent routing) — IMPLEMENTED (0.2.15-rc.1).** The producer's ruling
  was that a parent on Auto gives its children Auto (scheduled from their own
  spawn brief) while a parent on a concrete level gives them that level
  verbatim. The R5 section records the provenance rule, the live evidence and
  the accepted residuals.
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

## R5 — Subagent auto-routing (IMPLEMENTED, 0.2.15-rc.1)

**Status.** Shipped. The producer's ruling — "parent on a manual level => child
inherits it; parent on Auto => child is auto-routed" — is what the
implementation does.

**How it decides (provenance, not inference).** The host gives a child its
parent's LATEST REQUEST HEADER (`provider` / `model` / `reasoningEffort`, i.e.
the level this plugin stamped there) and persists `parentSession`,
`origin: "subagent"` and `delegationDepth` on the child's session header —
verified in `dsh-subagent/lib/types/child-agent.js` and on a live child log. The
interceptor therefore classifies a concrete child seed against OUR OWN decision
log: when the parent's last recorded decision was `auto` or `subagent` and its
level and route match the seed, the seed is our inheritance and the child is
scheduled from its own spawn brief (origin classification + warm-up floor +
frugal subagent demotion). Everything else passes through verbatim: a manual
pick, a pinned `defaultLevel`, a seed that does not match the parent's record, a
missing parent record, and any inherited `off` (a lineage safety pin is never
re-enabled).

**Evidence.** Six unit tests in `test/index.smoke.test.mjs` cover both halves and
every conservative fallback. One live spawn on 0.2.15-rc.1 recorded
`mode: auto, effort: high, stepClass: engineering` with the reason
"subagent inherited the parent's scheduled level; scheduled from its own brief";
the inherited seed was `max`, so the level changed — proof it was re-decided, not
copied.

**Live matrix (0.2.15-rc.2, Web host, sessions created over the session-controller
RPC — both halves verified, not just unit-tested):**

- parent pinned `max` (manual) -> child `manual/max`: inherited verbatim.
- parent on Auto -> child `auto/high` with the reason "subagent inherited the
  parent's scheduled level; scheduled from its own brief".

**Non-blocking delegation (found and fixed in 0.2.15-rc.2).** 0.2.1's
`subagent` tool returns immediately, so the parent stamps its NEXT step — with a
possibly different level — before the child's first request arrives (measured:
parent `auto/high` then `auto/max`, child seed `high`, child recorded
`manual/high`). rc.1 compared the seed against the parent's NEWEST decision
only, so the comparison missed. The rule now requires the parent's newest
decision to be `auto`/`subagent` (i.e. the parent is on our schedule right now)
AND the seed to match ANY recent scheduled level on that route.

**Residual (accepted, 0.2.15-rc.2).**

- Provenance reads the decision store's last 20 entries per session / 200
  sessions; an aged-out or cross-host parent record degrades to "inherit
  verbatim" — the safe direction, never an override of a possible human pick.
- A child spawned with an explicit effort override (a level the parent never
  scheduled on that route) is passed through, not rescheduled: the rule only
  claims levels it can find in the parent's own log.
- `subagentPreferCheap` remains a fixed policy (subagents always read cheap).
  It was never a config key; expose it if the demotion ever needs an opt-out.

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

**Further bounded in 0.2.15-rc.4.** The compaction scan now calls
`snapshotEvents(fromSeq)` with the session-seq watermark and reads only the
unseen suffix; the same watermark re-anchors on shrink, branch switch, and when
`compactionBump` is re-enabled.

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
- **Runtime evidence now available (0.2.15-rc.4).** New decisions carry
  `errorSources`, `contextPressure`, and `sessionTokens`, alongside the existing
  volume/repeat/consecSameTool fields. The next calibration pass should use
  these actuals to review the volume ramps, `escalateOnErrors`, the repeat
  channel, and the frugal-signal distribution before changing any value.

## Open decision — custom-model fill ownership (0.2.15-rc.4)

The review confirmed the long-standing limit: `settings.describe()` classifies
the profile patch's hand-declared models in `user`/`override`, while the fill
takes candidates from `base`. The result is that a profile-declared model never
enters the fill, and a model the installed catalog does not know (e.g. a newly
released model) can stay without levels. 0.2.15-rc.4 makes that visible: the
plugin logs the exact `provider/model` once and leaves the row untouched.

This is a producer decision because the same absence means "never configured"
AND "the Models page switch was turned off". Options:

1. Keep diagnostics + documentation: users declare `reasoningEfforts` for a
   catalog-unknown model (or use the Models page switch). Zero risk of undoing
   an explicit off choice.
2. Auto-fill catalog-unknown rows with a persistent tombstone so a filled row
   that the user later switches off is remembered and not re-added. More code,
   a one-time baseline migration, and a new state file field.
3. Offer an explicit opt-in config mode for filling user-layer rows. Simple,
   but a user who forgets the switch expects "off" and gets levels.

Until the producer rules, do not widen the write path. Track the decision here
and keep the diagnostic in place.

## Maintainer-only UI gate

`chatAnnotate` still has only a static host-seam check (2026-10-18); it is
default-off and should be looked at once during the next major version or a
related host-slot change. It is not a per-release development task. The new
rc.4 trajectory generation/cleanup behaviour is exercised by Web automation,
but visual capsule placement remains the producer's final acceptance item.
