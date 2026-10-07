# dsh-effort-router

English | [中文](README.zh.md)

A DSH (DeepSeek Harness) plugin: **context-aware per-step reasoning-effort routing**, plus reasoning levels for hand-declared `llm-pi-ai` custom models.

- Task-shape classification: `trivial / standard / engineering / hard` from the brief itself, not from tool-call counts
- Evidence escalation: tool errors and identical-argument retries lift the class (capped per task)
- Hysteresis: upgrades apply immediately, downgrades wait for two consecutive quiet decisions
- Frugal signals: subagents, context pressure, or a session token budget demote one class
- Capability clamp: the scheduled tier maps onto the target model's advertised vocabulary (nearest rank, so gateway vocabularies like `ultra` work)
- Manual wins: a concrete level in the selector passes through verbatim; Auto hands the step to the scheduler

## Why an Auto mask instead of a panel

The host's native model selector already is the per-session effort control. The plugin advertises an `Auto` level on every reasoning-capable model (injected into `reasoning.efforts`, resolved to a concrete wire level by the request interceptor before validation), so there is **no second selector to keep in sync**: Auto schedules, a concrete level passes through.

## Custom models (llm-pi-ai)

Hand-declared custom models often ship no `reasoningEfforts` table, so the composer shows no effort selector at all. On startup and on settings changes the plugin scans the `llm-pi-ai` config and fills the default `{ off: null, high, max }` table through a **resolution gate**: every table-less user-layer row is resolved with `resolveModelInfo`, and only models that resolve with NO thinking levels are filled — a model inheriting levels from its catalog is skipped, so catalog capability is never shadowed. An explicit table or an explicit `false` is never touched. Tables follow the pi-ai gate exactly (`off: null` omits the parameter on the wire — the shape the native Models page writes), and models filled on explicit `openai-completions` routes also gain `compat.supportsReasoningEffort: true`, the switch that protocol needs to actually send the effort.

The per-model level → gateway wire-value mapping (e.g. `high → ultra`) is edited under **Settings → Effort Router** and written straight into the `llm-pi-ai` config, gated by the official schema, effective on the next request. pi-ai serializes the table natively; no plugin-side translation layer.

## Settings

**Settings → Effort Router**:

- Enabled / default level / subagent default
- Bounds: allow max (off by default, hard falls back to high), max fallback, frugal demotion, context-pressure threshold, token budget
- Class → tier route table (trivial/standard default low, engineering high, hard max)
- Advanced: downgrade hysteresis, escalation thresholds (apply on plugin reload)
- Custom-model editor: expand a provider, tick levels and enter wire values, or fill missing levels everywhere in one click

## In-session visibility

- **Composer badge** (right of the model selector): the mode and effort of the session's last step (`Auto · high`), with class, score and reason in the tooltip. Read-only — control stays in the native selector.
- **Tool-call captions**: every tool call in the chat flow is annotated with the `provider/model · effort` that step actually ran with.

## Safety and degradation

- The interceptor is one try/catch: any error passes the request through untouched (fail-open)
- Models without reasoning metadata never receive `reasoningEffort` — never an `UNSUPPORTED_REASONING_EFFORT`
- Automatic routing never emits `off` (thinking continuity: a tool call made with thinking off poisons every later thinking-enabled request); an already-poisoned history pins `off` with a warning
- Session reads go through `deriveMessages()` + `sessionProjections` only; an empty sample raises an explicit warning instead of silently degrading

## Authorship & maintenance

- **Author**: kimi-k3 (an AI model, designing and coding through DeepSeek Harness).
- **Producer / repository owner**: KEI.NEO (@neo805) — the human publisher responsible for this repository.
- **Maintenance scope**: a personal hobby (vibe-coding) project, published for sharing. **No maintenance or updates are promised in response to external demand.**
- **Contribution policy**: this repository has **Issues disabled and does not accept Pull Requests**. Forks are welcome under the MIT license.
- **Disclaimer**: the software is provided "as is", without warranty of any kind (see LICENSE). Evaluate it yourself before production use.

## Thanks & license

MIT. The policy core (classification / escalation / hysteresis / tier mapping / signal collection / projection / store) is adapted from [@neptune810/dsh-model-router](https://github.com/Neptune810/dsh-model-router) (MIT © Neptune810); the capability layer and Auto-mask pattern follow [dsh-thinking-levels](https://github.com/drscrewdriver/dsh-thinking-levels) (MIT © drscrewdriver); the custom-model default-fill idea comes from [@hytime/dsh-thinking-effort](https://github.com/hytime/dsh-thinking-effort) (MIT © hytime).
