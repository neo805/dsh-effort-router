# Roadmap / 待推进需求

Recorded 2026-10-10, after the 0.2.0 code-review pass. Items are ordered by
the maintainer's priority; nothing here is scheduled until explicitly picked
up.

## R1 — Tool-call captions: retired from the chat flow (DONE, 0.2.1)

**Status quo.** 0.1.x annotated every tool call in the chat flow with the
`provider/model · effort` the step ran with (client surface 3:
`src/client/annotations.ts` + the host-side `effortRouterRoute` projection in
`lib/route-projection.js`). In 0.2.0 field testing the captions did not render
at all — the registration seam (`uiConversation.events.register` +
`conversation.chat.node`) apparently no longer anchors the rows, and nobody
missed them.

**Decision (maintainer).** The captions are NOT wanted back in the chat flow —
keep the conversation clean. Instead, the per-step assistant effort should be
visible in the host's **trajectory view** (轨迹视图).

**Implemented.** Removed the chat-annotation surface: `annotations.ts`,
surface 3 in `src/client/index.tsx`, the `.er-call*` styles, the
`annotation.default` locale keys, the host-side `effortRouterRoute`
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

## R5 — Subagent sessions never reach the auto scheduler (candidate, observed 2026-10-13)

**Observation (evidence).** A subagent spawned for a controlled experiment
(session `daebe1cc`, 3 steps) recorded `mode: 'manual', effort: 'max'` on
every step: subagent requests arrive carrying the parent's RESOLVED effort as
a concrete seed, and the echo guard cannot reclassify it — a fresh subagent
session has no decision-store history, so `isSelectionEcho` stays false and
the inherited level is indistinguishable from a human pick. Consequence:
`subagentPreferCheap` / `subagentEffort` never fire on the current host;
frugal demotion is dead code in practice. Fixing it needs host-side
delegation provenance (e.g. an explicit marker on subagent seeds) or a
plugin-side heuristic we have explicitly avoided so far (provenance over
inference). Parked until the maintainer weighs in on whether subagents
SHOULD be auto-routed at all.

## R6 — Evidence-window pollution after a host restart (candidate, observed 2026-10-13)

**Observation (evidence).** After a DSH restart, the in-memory per-agent
signal state is empty; the first collect of a resumed session replays the
whole projection from watermark 0, folding historical tool errors into the
sliding window. A resumed session's first steps therefore carry stale
escalations (measured: `windowErrors=5 → escalated on evidence x2` on the
first post-restart steps of session `53eaf0fb`, all from pre-restart
failures). The window ages out after 32 new buckets, so the blast radius is
the first few steps of a resumed session. Options: persist the watermark
with the decision store, or stamp evidence with wall-clock age and discount
old buckets. Not urgent — the lift is capped and self-heals.
