# Roadmap / 待推进需求

Recorded 2026-10-10, after the 0.2.0 code-review pass. Items are ordered by
the maintainer's priority; nothing here is scheduled until explicitly picked
up.

## R1 — Tool-call captions: retire from the chat flow, surface effort in the trajectory view

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

**What changes when picked up.**

- Remove the chat-annotation surface: `src/client/annotations.ts`, surface 3
  in `src/client/index.tsx`, the `.er-call*` styles in `src/client/styles.ts`,
  the `annotation.default` locale keys, and the README bullet (both
  languages). Rebuild `lib/client.js`.
- The data needed by a trajectory view already exists without any chat
  surface:
  - the stamped `request/header` session events carry the resolved
    `reasoningEffort` for every step (the trajectory view is built from the
    same event stream), and
  - the host-side `effortRouterRoute` projection (`lib/route-projection.js`)
    folds header + step + tool/call into a per-call table.
- Open question for implementation: whether the host's trajectory view renders
  `request/header` payload natively (then nothing plugin-side is needed —
  verify and document), or whether a plugin-side trace contribution seam
  exists. Investigate against the live host before writing code.
- If no trace seam exists: keep `lib/route-projection.js` (harmless, and it is
  the natural data source for a future trace view) but stop registering its
  chat renderer.

## R2 — Poison detection: replace the "no reasoning block ⇒ thinking was off" heuristic

**Problem.** The continuity guard (`toolCallWithoutReasoning` in
`lib/policy.js`, folded by `scanFresh`/`poisonedIn` in `lib/signals.js`)
infers "this assistant turn ran with thinking off" from the ABSENCE of a
reasoning block on a tool-call message. That inference is only sound for
routes that persist reasoning blocks — and it fails both ways:

- **False positive (observed, kimi-K3):** thinking is ON, but the model emits
  no reasoning block before tool calls. Every K3 tool loop looks "poisoned",
  so Auto pins `off` forever after the first tool call — the exact state the
  rule exists to avoid.
- **The strict-API problem is real for other models:** on thinking-mode APIs
  that reject mixed histories, an actual off turn carrying a tool call does
  poison every later thinking-enabled request. The guard cannot simply be
  deleted.

**Design direction (proposal, to be validated against live routes).**

1. **Self-calibrating persistence check.** Only treat a reasoning-less
   tool-call turn as poison when the SAME session proves this route persists
   reasoning blocks (at least one reasoning block exists anywhere in the
   derived history). Routes that never surface reasoning blocks (K3-style)
   then never declare poison; strict routes (K2-style, which persist
   `reasoning_content`) keep the guard with its original semantics.
2. **Provenance backstop.** Additionally declare poison when our own decision
   store proves a step in this session actually ran at `effort: off` with tool
   calls (manual off picks are recorded, mode `manual`). This covers the
   all-off-history edge where (1) has no positive persistence evidence.
3. **Config escape hatch.** A tri-state `poisonRecovery: 'auto' | 'strict' |
   'off'` (default `auto` = 1+2) lets users on provably non-strict models
   disable the pin, and users on strict gateways force it.
4. Compaction already re-derives the flag (the projection-shrink resync in
   `scanFresh`); keep that behavior — the pin must lift once the offending
   turn is gone.

**Open questions before implementation.**

- Confirm on live sessions which routes persist reasoning blocks in
  `deriveMessages()` (K3: tool-call turns only, or nothing at all?). The
  heuristic's correctness depends on this measurement, not on documentation.
- Whether to attempt reactive detection (pin `off` only after observing the
  API's thinking-mode rejection) as a complement — costs one failed request
  but removes all guesswork. Probably unnecessary if 1+2 hold.

## R3 — (done in the 0.2.0 review pass) README badge position

The READMEs said the composer badge sits right of the model selector; it
actually sits left. Doc-only fix, applied to `README.md` and `README.zh.md`
in the 0.2.0 review pass.
