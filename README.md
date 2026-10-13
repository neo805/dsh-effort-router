# dsh-effort-router

English | [中文](README.zh.md)

**Version:** `0.2.7-rc.2` · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

A DSH (DeepSeek Harness) plugin: **context-aware per-step reasoning-effort routing**, plus reasoning levels for hand-declared `llm-pi-ai` custom models.

- Task-shape classification: `trivial / standard / engineering / hard` from the brief itself, not from tool-call counts
- Wish detector: a short delegation-style brief in the cue vacuum zone (`帮我…`, `can you…`) starts at the engineering floor — underspecified tasks get the benefit of the doubt
- Evidence escalation: tool errors, identical-argument retries, brief text volume, and recent tool-result volume lift the class (loudest signal wins, capped per task, sliding 32-step window)
- Hysteresis: upgrades apply immediately, downgrades wait for two consecutive quiet decisions
- Frugal signals: subagents, context pressure, or a session token budget demote one class
- Capability clamp: the scheduled tier maps onto the target model's advertised vocabulary (nearest rank, so gateway vocabularies like `ultra` work)
- Manual wins: a concrete level in the selector passes through verbatim; Auto hands the step to the scheduler

## Why an Auto mask instead of a panel

The host's native model selector already is the per-session effort control. The plugin advertises an `Auto` level on every reasoning-capable model (injected into `reasoning.efforts`, resolved to a concrete wire level by the request interceptor before validation), so there is **no second selector to keep in sync**: Auto schedules, a concrete level passes through.

## Custom models (llm-pi-ai)

Hand-declared custom models often ship no `reasoningEfforts` table, so the composer shows no effort selector at all. On startup and on settings changes the plugin scans the `llm-pi-ai` config and fills the default `{ low, high, max }` table through a **resolution gate**: every table-less user-layer row is resolved with `resolveModelInfo`, and only models that resolve with NO thinking levels are filled — a model inheriting levels from its catalog is skipped, so catalog capability is never shadowed. An explicit table or an explicit `false` is never touched. The table deliberately has **no `off` rung**: an off selection followed by a tool call poisons the conversation for every later thinking-enabled request, and the router never routes to off either (you can still add `off: null` back per model in the editor — explicit intent is never overwritten). Models filled on explicit `openai-completions` routes also gain `compat.supportsReasoningEffort: true`, the switch that protocol needs to actually send the effort.

The per-model level → gateway wire-value mapping (e.g. `high → ultra`) is edited under **Settings → Effort Router** and written straight into the `llm-pi-ai` config, gated by the official schema, effective on the next request. pi-ai serializes the table natively; no plugin-side translation layer.

## Settings

**Settings → Effort Router**:

- Enabled / default level / subagent default
- Bounds: allow max (**on by default** since 0.2.0 — hard tasks reach max; opt out here and `maxFallback` applies), max fallback, wish detector, poison recovery, trajectory hoisting, frugal demotion, context-pressure threshold, token budget
- Class → tier route table (trivial/standard default low, engineering high, hard max)
- Advanced: downgrade hysteresis, escalation thresholds (apply on plugin reload), custom cue dictionaries (strong / normal / cheap / wish)
- Custom-model editor: expand a provider, tick levels and enter wire values, or fill missing levels everywhere in one click

## In-session visibility

- **Composer badge** (left of the model selector): the mode and effort of the session's last step (`Auto · high`), with class and reason in the tooltip. Read-only — control stays in the native selector.
- **Trajectory hoisting** (default on): each step's `provider/model · effort` is projected onto the NATIVE trajectory ledger rows (DOM projection anchored on `data-trajectory-row-key` — the assembly-layer route, no host package touched and no new view added). The anchor table is folded host-side from `request/header` + `assistant/message` + `tool/call` events and served on the state route. The chat flow itself stays annotation-free.

## Safety and degradation

- The interceptor is one try/catch: any error passes the request through untouched (fail-open)
- Models without reasoning metadata never receive `reasoningEffort` — never an `UNSUPPORTED_REASONING_EFFORT`
- Automatic routing never emits `off` (thinking continuity on strict thinking-mode APIs). A history PROVEN poisoned — a reasoning-less tool-call turn exists AND the session's decision log recorded a manual `off` step — pins `off` with a warning until compaction removes the offending turn. Shape alone never pins: models like kimi-K3 emit no reasoning blocks before tool calls with thinking on (measured, 2026-10-10). Disable via `poisonRecovery` if your routes are all non-strict
- Session reads go through `deriveMessages()` + `sessionProjections` only; an empty sample raises an explicit warning instead of silently degrading

## Authorship & maintenance

- **Author**: kimi-k3 (an AI model, designing and coding through DeepSeek Harness).
- **Producer / repository owner**: KEI.NEO (@neo805) — the human publisher responsible for this repository.
- **Maintenance scope**: a personal hobby (vibe-coding) project, published for sharing. **No maintenance or updates are promised in response to external demand.**
- **Contribution policy**: this repository has **Issues disabled and does not accept Pull Requests**. Forks are welcome under the MIT license.
- **Disclaimer**: the software is provided "as is", without warranty of any kind (see LICENSE). Evaluate it yourself before production use.

## Thanks & license

MIT. The policy core (classification / escalation / hysteresis / tier mapping / signal collection / projection / store) is adapted from [@neptune810/dsh-model-router](https://github.com/Neptune810/dsh-model-router) (MIT © Neptune810); the capability layer and Auto-mask pattern follow [dsh-thinking-levels](https://github.com/drscrewdriver/dsh-thinking-levels) (MIT © drscrewdriver); the custom-model default-fill idea comes from [@hytime/dsh-thinking-effort](https://github.com/hytime/dsh-thinking-effort) (MIT © hytime).
