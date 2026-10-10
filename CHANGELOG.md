# Changelog

All notable changes to dsh-effort-router are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- `lib/capability.js` carried a literal NUL byte in the cache-key separator
  constant, which made tools (git, grep, editors) treat the source file as
  binary. The separator is now spelled as the `'\0'` escape — same runtime
  value, text-clean source.
- The normalized live config (including ~200 compiled cue matchers) was
  rebuilt up to three times per request step — once in the interceptor, twice
  in signal collection. It is now memoized on the volatile snapshot and only
  recompiled when a setting actually changes.
- `toolCallsOf` stringified non-string tool-call arguments as
  `"[object Object]"`, which would have collapsed every same-name call onto
  one repeat-detection key on hosts that emit object arguments. Non-string
  arguments are now JSON-stringified.
- `depthOf` treated a `null` (not merely missing) `parentAgent` as a subagent.
- README (both languages): the composer badge sits LEFT of the model
  selector, not right.

### Removed

- Duplicate `@deepseek-ai/schemastery` entry in `devDependencies` (it remains
  a runtime dependency).

## [0.2.0] - 2026-10-10

### Added

- **Wish detector (on by default).** A short brief in the *vacuum zone* (no
  strong / structural / cheap / normal cue) that carries a delegation verb
  (`帮我`, `can you`, `how do i`, …) is an underspecified delegated task and
  starts at the engineering floor instead of standard. Bare question marks are
  deliberately not cues. Configurable via `wish`; the dictionary iterates over
  coming releases.
- **Volume cues.** Brief text volume (>400 / >1600 tokens, log ladder) and the
  sliding-window tool-result volume (>48k / >128k over the last 32 step
  buckets, anchored on measured local session distributions) now escalate the
  class just like tool errors. Cheap-intent steps are exempt. The applied lift
  is the LOUDEST single signal, capped per task — signals never stack.
- **Custom cue dictionaries.** Settings → Effort Router → Advanced accepts
  user additions to all four dictionaries (strong / normal / cheap / wish),
  merged on top of the shipped lists.
- Settings-card wish switch.

### Changed

- **`allowMax` now defaults to `true`.** The hard class routes to `max` out of
  the box (still gated by the hard-class threshold, the per-task escalation
  cap, and frugal demotion). Cost-sensitive users can opt out in Settings;
  `maxFallback` (default `high`) applies when max is disallowed.
- **Custom-model default fill table is now `{ low, high, max }` — no `off`
  rung.** An off selection followed by a tool call poisons the conversation
  for every later thinking-enabled request; the filled table no longer offers
  a level the policy itself refuses to route. `off` can still be added back
  per model in the editor (explicit user intent is never overwritten).
- **Tool evidence moved to a sliding window** (last 32 step buckets) shared by
  errors / identical-argument repeats / result volume: stale evidence ages out
  of long tasks instead of accumulating for the whole task.
- **The complexity score retired from decisions.** Its single tiebreaker duty
  (engineering + 82 → hard) was redundant with the dense-cue rules; the score
  remains in the decision log as telemetry and no longer appears on the badge.
  `hardScore` is retired.
- English cue matching now uses word boundaries (`capital` no longer steals an
  `api` hit, `sparse` no longer steals `parse`); CJK cues stay substring.
- Composer badge tooltip drops the score (class + reason remain).

### Fixed

- **Auto no longer decays into "manual" after a session's first step.** The
  host's `modelSelection` projection mirrors the last stamped request header
  into the session selection whenever no durable pick exists — and since this
  plugin resolves the scheduled `auto` into a concrete level before the
  header is stamped, step 2 came back carrying OUR scheduled value as if it
  were a manual pick (the native selector flipped off Auto the same way).
  Two cooperating layers, both anchored in our own durable decision store:
  after scheduling, the plugin appends `model/selection 'auto'` when no
  durable pick exists (the echo channel closes at the source and the
  selector keeps showing Auto; never written for subagent sessions or over
  an explicit pick); and a concrete seed is treated as a manual pick only
  when the store does NOT prove the session's last decision was our own
  auto schedule of the same effort on the same route — so an explicit pick
  that the host already consumed (pending cleared after a matching header)
  records `manual` and is never mistaken for an echo.
- **The decision store no longer leaks across profiles.** `resolveStoreFile`
  took the profile from env vars that the host only injects into tool
  sandboxes, never into plugin fibers — so a Desktop instance fell back to the
  `web` default and SHARED the Web profile's `state.json` (two instances
  racing one tmp+rename writer; Desktop decisions showed up only in Web's
  file). The store path now resolves through the host's `profileContext`
  service (`profile.dir`) with the env chain as fallback, and the resolved
  path is logged at plugin start.
- **With `enabled: false`, an `auto` selection is now stripped before the
  request passes through.** The mask is this plugin's own advertisement —
  unknown to the model — and could be rejected by request validation.
- Capability cache keys use a NUL separator (no theoretical provider/model
  collision); duplicate `llm/adapters-updated` listeners merged; dead code
  (`effortTierForClass`, the unconsumed `hasImage`/`rawText` signals, unused
  locale keys) removed; the settings-card model editor resets drafts on
  external table changes.

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
