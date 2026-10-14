# dsh-effort-router

English | [中文](README.zh.md)

**Version:** `0.2.8` · [Changelog](CHANGELOG.md) · [Roadmap](ROADMAP.md)

A DSH (DeepSeek Harness) plugin: **context-aware per-step reasoning-effort routing**, plus reasoning levels for hand-declared `llm-pi-ai` custom models.

- **The drift engine** (0.2.8): the task ORIGIN is classified once from the brief the user sent (`trivial / standard / engineering / hard`); evidence then drifts the class — `level = origin + error channel + volume channel − frugal`
- Error channel (short 6-step window, decay-weighted): tool errors, identical-argument retries, a just-completed todo (+1 — the next subtask is starting), and a carry from the previous task's unresolved failure
- Volume channel (long 32-step window): brief and tool-result tokens, **gzip-ratio discounted** (repetition is not information), graded by two linear ramps
- Warm-up floor: a fresh task never routes below its origin for the first steps (default 3); afterwards drift owns the level — aggressive saving, with the short error window as the feedback loop
- Wish detector: a short delegation-style brief in the cue vacuum zone (`帮我…`, `can you…`) starts at the engineering floor — underspecified tasks get the benefit of the doubt
- Frugal signals: subagents, context pressure, or a session token budget demote one class
- Capability clamp: the scheduled tier maps onto the target model's advertised vocabulary (nearest rank, so gateway vocabularies like `ultra` work)
- Manual wins: a concrete level in the selector passes through verbatim; Auto hands the step to the scheduler

## Why an Auto mask instead of a panel

The host's native model selector already is the per-session effort control. The plugin advertises an `Auto` level on every reasoning-capable model (injected into `reasoning.efforts`, resolved to a concrete wire level by the request interceptor before validation), so there is **no second selector to keep in sync**: Auto schedules, a concrete level passes through.

## Custom models (llm-pi-ai)

Hand-declared custom models often ship no `reasoningEfforts` table, so the composer shows no effort selector at all. On startup and on settings changes the plugin scans the `llm-pi-ai` config and fills the default `{ low, high, max }` table through a **resolution gate**: every table-less user-layer row is resolved with `resolveModelInfo`, and only models that resolve with NO thinking levels are filled — a model inheriting levels from its catalog is skipped, so catalog capability is never shadowed. An explicit table or an explicit `false` is never touched. The table deliberately has **no `off` rung**: an off selection followed by a tool call poisons the conversation for every later thinking-enabled request, and the router never routes to off either (you can still add `off: null` back per model directly in the `llm-pi-ai` config — explicit intent is never overwritten). Models filled on explicit `openai-completions` routes also gain `compat.supportsReasoningEffort: true`, the switch that protocol needs to actually send the effort.

The per-model level → gateway wire-value mapping (e.g. `high → ultra`) lives in the model's `reasoningEfforts` table inside the `llm-pi-ai` config — edit it directly or ask your agent to. The official schema validates it and the next request picks it up. pi-ai serializes the table natively; no plugin-side translation layer.

## Configuration (no settings UI — everything lives in the config file)

**The plugin deliberately ships NO settings UI** (since 0.2.7-rc.6): every user-facing option lives in the plugin configuration, stored on the profile side, so **upgrading the plugin package never overwrites it**. Change options by editing the config or by asking your agent in natural language ("hide the badge", "allow max").

- `enabled`: master switch (off = requests pass through untouched)
- `defaultLevel`: level when nothing is selected (`auto` or a concrete level)
- `subagentEffort`: subagent default (`inherit` or a concrete level)
- `allowMax` / `maxFallback`: automatic routing may reach max (**on by default** since 0.2.0); off collapses max to `maxFallback`
- `wish` / `poisonRecovery` / `frugalDemote` / `contextPressure` / `sessionTokenBudget`: wish detector, poison recovery, frugal demotion and their thresholds
- `showBadge`: show the read-only badge left of the composer model selector (default on)
- `trajectoryAnnotate`: project each step's `provider/model · effort` onto the native trajectory ledger (default on; switch off if it conflicts with another plugin)
- `chatAnnotate`: add a `provider/model · effort` caption row under each tool call in the conversation view (**default off**; read once at client load, so a toggle applies on page reload)
- `fillCustomModels`: auto-fill default effort tables for hand-declared custom models
- `routes`: class → tier route table (trivial/standard default low, engineering high, hard max)
- `shortWindow` / `longWindow` / `errorDecay`: window sizes and the per-bucket decay weights of the error channel (defaults 6 / 32 / `1,0.8,0.6,0.5,0.4,0.3`)
- `briefRamp` / `toolRamp` / `compressDiscount`: linear volume ramps in effective tokens (defaults `400,1600` / `48000,128000`) and the gzip-ratio discount switch
- `warmUpSteps` / `trivialLiftCap`: origin warm-up floor length (default 3) and the total lift a trivial origin allows (default 1)
- `escalateOnErrors` / `escalateOnRepeats` / `maxEscalations` / `todoBump`: error-channel thresholds, its total cap, and the todo-completion bump
- `downAfter`: **deprecated** (0.2.8 retired hysteresis) — kept so old config files still validate; ignored
- `cuesStrong` / `cuesNormal` / `cuesCheap` / `cuesWish`: custom cue dictionaries (merged on top of the built-in ones)
- `dictStrong` / `dictNormal` / `dictCheap` / `dictWish`: **full dictionary replacement** — when non-blank, this list IS the whole dictionary (the shipped list is dropped; additions AND deletions both work), while the matching `cues*` additions still merge on top. Blank (default) = shipped dictionary. Read the effective lists from `GET /effort-router/dictionaries` (with the `builtin` reference) before editing, then write the result back to `dict*`; or just tell the agent "remove xx from the strong dictionary"

## In-session visibility

- **Composer badge** (left of the model selector, gated by `showBadge`): the mode and effort of the session's last step (`Auto · high`), with class and reason in the tooltip. Read-only — control stays in the native selector.
- **Trajectory hoisting** (`trajectoryAnnotate`, default on): each step's `provider/model · effort` is projected onto the NATIVE trajectory ledger rows (DOM projection anchored on `data-trajectory-row-key` — the assembly-layer route, no host package touched and no new view added). The anchor table is folded host-side from `request/header` + `assistant/message` + `tool/call` events and served on the state route. The chat flow itself stays annotation-free by default.
- **Chat captions** (`chatAnnotate`, **default off**): when enabled, each tool call gains a `provider/model · effort` caption row fed by the same anchor projection.

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
