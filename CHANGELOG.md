# Changelog

All notable changes to dsh-effort-router are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

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
