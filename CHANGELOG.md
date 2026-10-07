# Changelog

All notable changes to dsh-effort-router are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-10-08

### Fixed

- **The custom-model fill never ran — at all, since 0.1.0.** The host-side fill
  guarded on `settings.get(ns)` / `settings.update(ns, patch)`, but the live
  `@deepseek-ai/dsh-settings` seam has no `get`: it exposes `describe()`
  (volatile-field projections with a revision) and
  `update(ns, patch, expectedRevision)`. The guard failed on every host, the
  sync returned silently before any candidate was even enumerated, and no
  custom model ever received a `reasoningEfforts` table — which is why
  custom-API routes (hand-declared `api`/`baseURL` gateways with no catalog)
  still show no effort selector, while catalog providers (whose models inherit
  levels) were unaffected. The fill now reads the `llm-pi-ai` descriptor via
  `describe()` (user layer first, live value as fallback) and writes through
  `update()` with the descriptor's revision as the conflict guard; a host
  without the describe/update seam now logs an explicit warning instead of
  skipping silently.
- The integration test's settings mock now mirrors the real dsh-settings seam
  (`describe`/`update` with revision), and asserts the fill write carries the
  conflict-guard revision — a regression net for the exact API mismatch above.

## [0.1.2] - 2026-10-07

### Fixed

- **The fill write was rejected by the pi-ai gate and no model was ever
  filled.** The default table spelled `off` as an empty string; pi-ai rejects
  empty wire values (`reasoningEfforts.off must not be an empty string`) — only
  `off: null` omits the parameter, the shape the native Models page writes.
  The default table is now `{ off: null, high: 'high', max: 'max' }`, and
  `normalizeEffortTable` (empty/blank → null for `off`, dropped otherwise)
  plus `validateEffortTable` (a local mirror of the pi-ai gate) keep every
  write — automatic fill and settings-card edit — valid before it is sent.
- Models filled on explicit `openai-completions` routes now also gain
  `compat.supportsReasoningEffort: true` (mirroring the native Models page):
  without it the level validated but was never serialized on the wire.
- Settings-card saves are pre-validated locally and name the exact problem
  instead of failing with a bare rejection; the card's "fill all" stays
  conservative (custom-gateway routes only — the host's resolution-gated fill
  covers catalog routes safely).

### Changed

- A fill candidate whose resolution fails is now logged once (a permanently
  failing resolution is visible instead of a silent skip).
- A failing decision-store write warns once per run (in-memory decisions keep
  working; the badge never depends on the disk).

## [0.1.1] - 2026-10-07

### Fixed

- **Custom-model fill-in now uses a resolution gate.** The 0.1.0 rule identified
  custom gateways by explicit `api` / non-official `baseURL`, which skipped
  catalog-backed pi-ai routes whose hand-declared `models[]` rows carry no
  `reasoningEfforts` — exactly the routes where the fill matters. The fill now
  enumerates every user-layer row without a table (`fillCandidates`), keeps only
  models whose `resolveModelInfo` advertises no thinking levels
  (`resolveFillTargets`, exported for tests), and fills those. Catalog models
  inheriting levels are provably skipped; a failed resolution defers the model
  to the next trigger instead of writing blindly.
- Composer badge: `manual-stripped` decisions render as "Manual"; an empty
  decision log shows `Auto` with a "no routing decision yet" tooltip.

### Added

- End-to-end offline test: fill → capability refresh → auto scheduling on a
  previously bare custom model, plus manual passthrough and the
  off/high/max tie-to-stronger clamp.
- Production-shaped fill simulation test (resolution-gated, idempotent).

## [0.1.0] - 2026-10-07

### Added

- Host kernel: per-step effort scheduling — task-shape classification
  (`trivial / standard / engineering / hard`), evidence escalation (tool
  errors, repeated calls, unresolved-failure carry), one-class frugal demotion
  (subagent / context pressure / token budget), hysteresis (`downAfter: 2`),
  opt-in `max` (fallback `high`), never-off thinking continuity with a
  poisoned-history recovery pin.
- Capability layer: per-model reasoning metadata cache; `auto` mask advertised
  through every adapter's `resolveModel`; unsupported models get the effort
  stripped instead of an `UNSUPPORTED_REASONING_EFFORT` rejection.
- Custom-model fill-in for llm-pi-ai and a settings-card editor for the
  per-model level → gateway wire-value table.
- Settings card (global bounds, route table, advanced thresholds) under
  Settings → Effort Router; read-only composer badge; per-tool-call effort
  captions in the chat flow.
- Read-only `GET /effort-router/state?sessionId=…` route; atomic debounced
  decision store at `<profile>/.effort-router/state.json`.
- 50 unit / replay / smoke tests (`node --test`).
