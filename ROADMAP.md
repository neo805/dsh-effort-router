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

## R4 — Decision trace surface (plugin-side substitute for trajectory-view effort)

**Context.** R1 retired the chat-flow captions on the understanding that the
trajectory view would show per-step effort; the host does not render
`request/header` payloads (verified 2026-10-11), so that information is
currently only in the decision log (`<profile>/.effort-router/state.json`)
and the read-only route `GET /effort-router/state?sessionId=…` (which already
returns the last 20 decisions with turn/step/mode/effort/class/reason).

**Proposal (awaiting maintainer decision).** A third, read-only client surface
that lists the session's recent decisions — the trace the trajectory view was
meant to provide, without touching the chat flow. Placement options:

- a collapsible section inside the composer badge's tooltip/popup (cheapest,
  but tooltips are a poor list container);
- a small dock/panel card fed by the same state route the badge already polls
  (clean, persistent, out of the conversation);
- a section at the bottom of Settings → Effort Router (no new surface, but
  far from the session context).

Data plumbing needs nothing new: the badge's poll already fetches `recent`;
the surface only renders it. The open question is placement, not feasibility.

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
