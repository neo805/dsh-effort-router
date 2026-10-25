# Changelog

All notable changes to dsh-effort-router are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.16-rc.2] - 2026-10-25

Projection-contract fix release. No routing-policy change: the same signals are
now read from the host's actual projection schemas and remain available when the
optional projection service registers after plugin apply.

### Fixed

- `sessionTokensOf()` read nonexistent `input/output/cacheRead/cacheWrite/
  reasoning` keys from the `tokenUsage` projection. The host
  (`dsh-token-meter`, stateVersion 2) exposes
  `uncachedInputTokens/outputTokens/cacheReadTokens/cacheWriteTokens`; the old
  helper therefore always returned 0, so `sessionTokenBudget` could never fire.
- `createSignals()` received the sessionProjections service by value at apply
  time. The plugin declares no hard projection dependency, so a service that
  registered later stayed `undefined` for the whole process. The service is now
  resolved lazily at collect time.

### Added

- Decision telemetry: `projectionsAvailable`, `contextPressureAvailable`,
  `tokenUsageAvailable`, `todosAvailable`, `todosCount`, and
  `todoTransitions`. These distinguish "no service", "service present but key
  absent", and "a real todo completion was observed" without reading user text.
- Tests for the real `tokenUsage` field contract, cache-only token totals, a
  projection service registered after `createSignals()`, and todo-transition
  diagnostics. Test baseline 211 → 212.

### Notes

- `sessionTokenBudget` remains 0 (disabled) by default; this release only makes
  the metric real, it does not choose a budget.
- `todoBump` logic is unchanged. The 7-day study had no projection-enabled
  same-turn completion→request sample, so this release adds observability rather
  than changing the bump rule.

## [0.2.16-rc.1] - 2026-10-25

The integer-rank routing release. The four origin classes remain the task
taxonomy; drift, ceilings and capability mapping now operate on ranks 0..7
(`0` off/none reserved for safety, normal Auto uses `1..7`).

### Added

- **Fine-grained integer drift.** `routes` maps the four origin classes to
  anchor ranks; error/volume/frugal evidence moves the target rank directly.
  With default anchors, standard+1 is now `medium` (was `high`) and
  engineering+1 is `xhigh` (was `max`).
- **Global second-layer allow-list.** `allowedEfforts` restricts the final
  advertised selector id; empty means every non-off advertised level.
- **Directional quantization.** `effortFallback` supports `nearest-up`
  (compatibility default), `up`, and `down`, each with boundary clamping when
  no candidate exists in the requested direction.
- **Ordered unknown-selector normalization.** Adapter vocabularies whose ids
  are not canonical are interpolated from their advertised order and logged
  once instead of all ranking as `high`.
- **Decision telemetry:** `targetRank`, `targetTier`, and `mapping`
  (`exact`/`up`/`down`/`nearest-up`/boundary clamp/unsupported); Badge tooltip
  shows origin → target rank/tier → mapping, while its label still shows the
  actual effort only.

### Changed

- `routes` accepts every non-off canonical level
  (`minimal/low/medium/high/xhigh/max/ultra`). Defaults are unchanged; the four
  anchors must be non-decreasing or the table falls back as a whole with a
  warning.
- Auto can now target every rank up to the configured hard anchor. The default
  hard anchor remains `max`, so `ultra` is reachable only by explicit config.
- `allowMax` / `maxFallback` are deprecated. `allowMax=false` migrates to an
  `allowedEfforts` ceiling through `maxFallback`; explicit old+new controls are
  reported as a conflict and the explicit allow-list wins.
- `stepClass` is no longer a post-drift synthetic class (always `null` in new
  decisions); `originClass`, `targetRank`, and `targetTier` are authoritative.

### Fixed

- `allowMax=false` could still emit `max` through nearest mapping on a
  `low/max` vocabulary. The second-layer allow-list now constrains the FINAL
  output, closing that path.

### Shadow

- Replayed 566 real rc.5 decisions with default config against the new kernel:
  target changed in 183 (32.3%). Old target distribution was
  low 236 / high 243 / max 87; new targets spread across
  minimal 2 / low 203 / medium 66 / high 178 / xhigh 95 / max 22. Final effort
  distribution cannot be reconstructed from logs because advertised
  vocabularies were not recorded.
- Test baseline: 194 → 211 tests.

## [0.2.15-rc.5] - 2026-10-25

Review-fix release for the rc.4 code audit. No new user-facing option and no
scheduling-threshold change; the fixes repair behavior where the documented
contract was not actually enforced.

### Fixed

- **Parallel tool results now share one assistant-call bucket.** Every v4
  `role:"tool"` result used to seal immediately, so the first result closed a
  batch while later parallel results became empty buckets. The first error in a
  two-call batch therefore decayed to weight `0.8` and failed to lift the step.
  Results now accumulate in the open batch and it is sealed by the next
  assistant-call batch or task boundary; the orchestration-return event still
  fires once per batch.
- **Auto can no longer leak through fixed-level mapping or the interceptor
  catch.** `mapEffort` excludes the virtual `auto` sentinel, fixing
  `defaultLevel` / `subagentEffort` values such as `medium` that could resolve
  back to `auto`. The disabled and error paths now share the same strip helper:
  concrete requests still fail open by reference, Auto never reaches the host.
- **Manual-off poison provenance survives the 20-decision ring.** The decision
  store keeps a per-session `manualOff` flag, migrates it from older `recent`
  rows, and the interceptor clears it when the reasoning-less tool-call shape
  disappears. A proven pin therefore lasts until compaction, without arming a
  later unrelated K3-style shape.
- **A transient capability-resolution failure is no longer permanent.**
  Successful no-reasoning resolutions remain cached; a thrown resolution
  answers conservatively for that request but is not written to the long-lived
  cache, so the next step can recover without adapter churn.
- **Adapter churn releases stale Auto wrappers.** Each re-advertise pass disposes
  the wrappers it installed before wrapping the current adapter set, instead of
  retaining removed adapters until plugin unload.
- **Badge shows the effort actually sent.** A missing `effort` no longer falls
  back to the target `tier`; `poisoned-unsupported` and unsupported schedules
  show no fabricated level.

### Changed

- **Long-window repeat keys keep full argument equality with a bounded
  footprint.** Production signals hash the complete canonical argument with
  SHA-256 and retain `name|digest`; policy remains import-free and receives the
  fingerprint through injection. A 32×1 MiB probe retained about `0.1 MiB`
  after collection instead of about `34 MiB`; canonical construction still has
  a transient peak.
- Test baseline: 183 → 194 tests; line coverage 99.38%, branch 85.85%, function
  97.97%.

## [0.2.15-rc.4] - 2026-10-25

Hardening pass after the 0.2.15-rc.3 code review. No settings UI and no new
user-facing option; the scheduling contract is unchanged except where a bug
made it unsafe.

### Added

- **Failure-source telemetry in the decision log.** Scheduled decisions now
  carry `errorSources` (`isError`, `exit-bracket`, `exit-line`, `en`, `cjk`,
  `exit0-traceback`), plus raw `contextPressure` and `sessionTokens`. This is
  the observation side of audit D52/R4; no threshold changed in this release.
- **A loud diagnostic for unsupported custom models.** A model declared only
  in the settings user/profile layer that resolves with no reasoning levels is
  named once in the log, with the remedy (declare `reasoningEfforts`), instead
  of silently receiving no Auto entry. The user-owned row is still never
  rewritten.

### Fixed

- **The Auto mask now has an owner.** Adapter wrappers are restored on plugin
  unload (only while our wrapper is still current), and resolved model info is
  copied instead of mutated in place. Capability cache writes are
  generation-guarded and concurrent misses share one resolution.
- **Auto can no longer emit a non-thinking effort.** An off-only vocabulary
  strips the field and logs why; a poisoned-history pin is applied only when the
  target really advertises `off`. If it does not, the request is sent without a
  fabricated pin and the downgrade is reported (`poisoned-unsupported`).
- **Identical-argument repeat detection uses the complete canonical argument.**
  The old 400-character prefix could classify two different large writes as a
  repeat and escalate the step. Parsed object arguments are also canonicalized
  only once.
- **Client session switching cannot repaint the previous session.** Trajectory
  responses are generation-gated; Badge state is bound to its session id;
  ordinary `session-<uuid>` URLs retain their prefix; cleanup removes caption
  nodes; and a second on-screen ledger is never decorated with the first one's
  table.
- **Stored anchor reads are single-flight and errors are per request.** Two
  pollers share one log read, failures are negatively cached briefly, a stale
  read cannot overwrite a newer one, and `anchorsError` no longer leaks across
  sessions. A hint can still find an idle session outside the 8-session merge
  slice via cached projections.
- **Compaction scans read only the unseen event suffix** (`snapshotEvents(fromSeq)`),
  instead of materialising the whole log every step.
- **Store lifecycle:** compact JSON, `flush()` cancels its pending timer, and
  `dispose()` persists the last decision. Client tests now use a temporary
  profile instead of the real decision store.
- **Smaller correctness fixes:** programmatic cue replacement now honours
  `extraCues`; spaced arrow functions count as code; effort ranks no longer read
  inherited object properties; re-enabling `todoBump` no longer replays a
  completion from the disabled period; the CJK failure marker accepts a
  line-ending colonless form.

### Changed

- Read-only state route supports `view=badge|anchors|config` (default `full`).
  The built-in Badge no longer requests anchors, trajectory no longer downloads
  decision history, and the one-shot chat-flag read fetches neither.
- The trajectory poller makes no anchor request outside the trajectory ledger,
  filters unrelated DOM mutations, and leaves the safety sweep in place.

## [0.2.15-rc.3] - 2026-10-18

### Fixed

- **A subagent session's trajectory view lost its per-step capsules** (reported
  2026-10-18 on a live child session: no `#1 · provider/model · effort` chip, or
  a chip carrying a NEIGHBOURING session's provider). An agent session created
  through the agent service carries a BARE uuid (`b653563f-…`), while an
  ordinary conversation session is `session-<uuid>`. The decorator's identity
  check only accepted the prefixed shape, so a subagent pane read as "no
  session id", fell through to the merged anchor table, and that table's
  per-session `assistant\0<turn>\0<step>` keys collide by construction — the
  ambiguity-safe merge then dropped the key (no caption) or a single-candidate
  table painted the wrong provider.
- The fix accepts both id shapes and is verified from the host side: the state
  route already answers correctly for a bare agent id (`resolved=stored`, the
  child's own `assistant\0 1 \0 1` → `deepseek-account/deepseek-flash · high`),
  so only the client's identity gate was wrong.
- The identity and row-key contract moved out of the TSX-adjacent TS into
  `src/client/ids.js` (plain ESM, bundled by esbuild like the rest) so it is
  unit-testable: `test/client-ids.test.mjs` pins both id shapes and the
  tool/assistant row-key decoding, including the malformed-key cases.

## [0.2.15-rc.2] - 2026-10-18

### Fixed

- **A subagent spawned from an Auto parent could still inherit its parent's
  level as a manual pick.** 0.2.1 delegation is NON-BLOCKING: the parent stamps
  its next step before the child's first request lands, and that step can carry
  a different level (measured live on the Web host: parent `auto/high` then
  `auto/max`, child seed `high`, child recorded `manual/high`). rc.1 required
  the seed to equal the parent's NEWEST decision, so the comparison missed and
  the child fell back to inherit. The rule now requires the parent to be on our
  schedule right now (its newest decision is `auto` / `subagent`) AND the seed
  to match ANY recent scheduled level on that route. A parent whose newest
  decision is a manual pick or a pinned default still hands its children that
  level verbatim.

## [0.2.15-rc.1] - 2026-10-18

Subagent routing (ROADMAP R5) plus an internal cleanup pass.

### Added

- **Subagents are auto-routed when their parent ran on Auto.** Until now a
  child inherited its parent's level as a concrete seed that read exactly like a
  human pick, so `subagentEffort` and the subagent frugal demotion never ran.
  The child's seed is now classified by PROVENANCE, not by guessing: the host
  gives a child its parent's latest request header (the effort this plugin
  stamped) and persists `parentSession` / `origin: "subagent"` /
  `delegationDepth` on the child session. If the parent's last recorded decision
  was one of OUR schedules (`auto` or `subagent`) and it matches the seed's
  level and route, the child is scheduled from its own spawn brief (origin
  classification + warm-up floor + frugal subagent demotion, as designed).
- `MAINTAINER-TESTS.md`: the standing list of checks only the producer can run
  in a real client (how to enable, expected result, failure judgement,
  rollback), re-checked once per major version rather than per release.

### Changed

- **A parent's MANUAL pick is still inherited verbatim** — that is the half of
  R5 that must never regress. Same for a pinned `defaultLevel`, a seed that
  does not match the parent's recorded decision, a child whose parent record is
  gone, and an inherited `off` (a lineage safety pin is never re-enabled).
- Internal cleanup, no other user-visible behaviour change: the production-dead
  `withDefaultEfforts` transform and the never-configurable
  `subagentPreferCheap` policy default are gone; both tool-result folds share
  one helper; the compaction event scan is skipped whole while `compactionBump`
  is off (re-enabling re-anchors instead of replaying); a step reads the
  volatile config snapshot once instead of twice; the trajectory chip skin is
  read once per decorator instead of per row.
- ROADMAP R5 rewritten as "direction set, not implemented" (it was wrongly
  recorded as settled) and now updated with the shipped design; R6 rewritten to
  describe window lengths as config parameters rather than fixed numbers; a
  "Deferred calibration" section records the audit's next-cycle work.

## [0.2.14] - 2026-10-18

Root cause of the empty history captions: the fallback called
`sessionQuery.load()`, which is NOT part of the public service surface in
0.2.1 — `load` lives on the internal corpus object, so the route always
answered "no table". The public read API `readSession(sessionId)` reads and
replay-validates one complete log WITHOUT making the session live (no write
lease); `observeSession()` is the lease-based observation used as the
fallback when `readSession` is absent. The same read-only contract holds:
the route never resumes, claims, or writes a session.

## [0.2.13] - 2026-10-18

Diagnostics for the stored-log anchor fallback: the route now reports
`anchorsError` (service unavailable / `load` missing / load failure text)
when a known session could not be read from persistence, so the field can
tell "no data source" from "empty log".

## [0.2.12] - 2026-10-18

Trajectory captions for HISTORY sessions on the Web UI. After 0.2.11 fixed
the wrong attribution, many history panes painted no capsule at all:
sessions opened from history are served through `sessionQuery` and are NOT
attached to the live `sessions` store in 0.2.1, so the state route — which
read the anchors from the live session projection — answered "unknown
session" and the client painted nothing.

### Fixed

- **The state route resolves a known session from its persisted log when
  it is not live**: `sessionQuery.load()` returns the stored events, the
  same pure anchor fold runs over them, and the table is cached for 30 s
  per session (LRU-bounded) so the 2.5 s client poll costs one log read at
  most. `anchorsResolved` gains the `stored` value. An unknown id still
  returns no table (never the merged substitute).

## [0.2.11] - 2026-10-18

Trajectory caption identity fix for the Web UI. Reported shape: after
viewing session A (qwen route) and switching to session B (deepseek route),
B's trajectory rows showed A's provider/model capsules — and the reverse
order behaved the same; some panes painted no capsule at all, so caption
presence and text were unstable.

### Fixed

- **The Web SPA keeps the session id out of the URL.** The trajectory
  decorator derived the on-screen session from `location.href`, so after
  the first switch every session looked alike to the merged fallback;
  `assistant\0<turn>\0<step>` keys are per-session coordinates and
  collided, painting a neighbouring session's capsule. The session id is
  now read from the DOM first — 0.2.1's conversation root stamps
  `data-conversation-session`, and the 对话/轨迹 tabs render inside it —
  with the URL only as a fallback. Session switches clear the captions
  synchronously (the root attribute is observed too) before the next poll
  repaints from the correct per-session table.
- **The merged fallback is ambiguity-safe**: a key whose provider/model/
  effort is not identical across every candidate table is dropped instead
  of "newest wins". Missing captions are honest; a wrong capsule is not.
- **A known session id whose session the runtime cannot read no longer
  falls through to the merged table** — the route returns no anchors (the
  client paints nothing) instead of another session's data.

## [0.2.10] - 2026-10-18

DSH 0.2.1-rc.2 support. The host now judges third-party plugins by
`engines.dsh` first, so the ranges widen; the 0.2.1 feature that lets the
Models page declare per-model reasoning levels in the UI changes what the
custom-model fill may touch; and the new unified subagent settlement notices
needed both a detection path and a protection rule.

### Added

- **DSH 0.2.1 compatibility declarations**: `engines.dsh` and every peer
  range widen from `<0.2.1-0` to `<0.3.0-0`; the `dsh.client.inject` list
  drops `@deepseek-ai/dsh-client-ui-slots` (the package no longer exists in
  0.2.1 — the slot service ships inside the renderer).
- **Subagent settlement detection** (channel ①): 0.2.1 unified delegation —
  the tool returns a child id immediately and the RESULT arrives later as a
  `user/message` with `source.kind === 'subagent-settled'` (or an
  `agent-message` relay). Both now raise the `subagentReturnBump` event, so
  the bump fires when the parent actually integrates the result instead of
  only at the dispatch moment.
- **Settings layer split in the custom-model fill** (`lib/custom-models.js`
  `planFill` / `userOwnsModel`): 0.2.1's `settings.describe()` exposes
  `base` (profile layer), `user` (settings-document edits) and `value`.
  Candidates now come from `base`; a row the user layer owns is skipped,
  because the Models page's reasoning-effort switch stores OFF by REMOVING
  the field — re-filling it would silently undo an explicit choice. The
  write only carries the providers it touched (settings.update merges).

### Fixed

- **Synthetic user-role messages are no longer briefs** (present since
  0.2.8, amplified by 0.2.1's unified notices): runtime-context snapshots,
  skill catalogs, compaction checkpoints, ACP nudges, adjacent-agent
  relays, settlement notices, model-switch and approval notices all derive
  as `role: "user"` messages. The synthetic-task path treated every one as
  an unannounced brief — opening a phantom task (resetting the origin
  anchor, the error epoch, the carry and the warm-up) and charging its text
  to the volume channel (skill catalogs alone run thousands of
  characters). The brief path now accepts only `source.kind === 'user'`
  (sourceless legacy projections still accepted), and `lastUserText` uses
  the same filter.
- `test/integration.test.mjs` now models the real layered `describe()`
  (base/user/value); the fill assertion checks that untouched providers are
  absent from the write instead of being rewritten.

## [0.2.9] - 2026-10-15

Two more channel-① event bumps, approved alongside the todo-completion
bump: orchestration returns and compaction checkpoints. Both fire +1
inside the short window, once per step no matter how many landed, and
share the error channel's `maxEscalations` cap.

### Added

- **`subagentReturnBump`** (default on): a sealed step bucket whose calls
  included `subagent` / `subagent_fork` / `workflow` marks an
  orchestration return — the parent must now integrate the result and
  decide the next move. The information itself stays priced by channel ②
  (gzip-discounted volume); this bump prices the EVENT. Detection is a
  tool-name check on the fold that already runs, so the hot path pays
  nothing. Foreground runs and background settles landing as the original
  call's tool result are both covered.
- **`compactionBump`** (default on): a compaction checkpoint just
  replaced the working map — the steps after it run on the least
  reliable context (summary read as complete truth, lost threads, redone
  work), which is exactly where reasoning depth pays most. Detection is
  engine-agnostic: a watermark scan of `session.snapshotEvents()` for the
  shared checkpoint marker (`user/message` with `source.plugin ===
  'compact'` or `source.kind === 'compact-checkpoint'`, or the
  `compaction/end` lifecycle event) — verified in the host asar against
  `@deepseek-ai/dsh-compaction` and the ACP engine, which land through
  the same primitives. The event list is NOT cleared at task boundaries
  (the lossy map is still the map). `snapshotEvents` is read behind
  guards only — `session.events` remains forbidden (design rule 1) — and
  a host without the surface degrades silently to "no signal".
- Decision-log observation fields `subagentReturn` / `compaction` for the
  next calibration cycle.

## [0.2.8] - 2026-10-15

The drift engine. The per-step re-classification of 0.2.x is replaced by an
origin anchor plus four evidence channels; every window/weight/floor ships
as a user-tunable config key (the maintainer's design philosophy: defaults
are shipped, freedom is kept).

### Added

- **Channel ④ task origin, classified ONCE per task** (`lib/signals.js`
  `openTask`): the originating brief runs through the dictionary/shape/
  plan-like cue pipeline and anchors the class; later steps never
  re-classify. Interjections and question answers open a task too —
  unless they land inside the previous task's warm-up, in which case the
  STRONGER origin wins and the warm-up restarts. Unannounced user texts in
  the projection open a task synthetically (resumed windows; a message
  followed by assistant/tool work resumes with the warm-up EXPIRED).
  Subagent fallback: spawn text classifies, empty text anchors `standard`.
- **Channel ① short window** (`shortWindow`, default 6 tool batches) with
  per-bucket **decay weights** (`errorDecay`, default `1,0.8,0.6,0.5,0.4,0.3`,
  newest first): tool errors and identical-argument repeats fold as
  weighted sums; the evidence rungs are freshness-aware (`decayThreshold`
  sums the N freshest weights, so N fresh events always reach their rung
  and staleness only discounts). New **todo-completion bump** (`todoBump`,
  default on): a status transition to completed in the todos projection
  adds +1 while inside the window (content-matched, so a rewritten list
  fires nothing; several completions in one step fire once). The
  unresolved-failure **carry** now decays with the short window.
- **Channel ② long window** (`longWindow`, default 32) of **gzip-discounted
  effective tokens** (`compressDiscount`, default on; `lib/compress.js`,
  native `zlib` level 1, <256 B never discounted, ratio clamped ≤ 1 — a
  loop log is not information). Graded by two **linear ramps** read
  separately, the louder speaks: `briefRamp` (default `400,1600`) and
  `toolRamp` (default `48000,128000`), one bump per rung, user-extensible.
- **Warm-up floor** (`warmUpSteps`, default 3): a fresh task never routes
  below its origin; afterwards drift owns the level — aggressive saving is
  safe because the short error window is the feedback loop. A trivial
  origin caps the total lift at `trivialLiftCap` (default 1).
- **Observation fields in the decision log**: `originClass`, `warmup`,
  `briefEffective`, `briefVolume`, `briefVolumeRaw`, `toolVolumeRaw`,
  `weightedErrors`, `weightedRepeats`, `todoBump`, `carry` ride alongside
  the existing raw counters for the next calibration cycle.
- `test/compress.test.mjs`; drift-engine suites in `test/signals.test.mjs`
  (104 tests total).

### Changed

- **Channels STACK** (`level = clamp(origin + ① + ② − ③)`): the 0.2.x
  "loudest evidence wins, bumps never stack" rule is retired.
- `escalateOnErrors` / `escalateOnRepeats` thresholds now read the
  decay-weighted sums through freshness-aware rungs (flat weights reproduce
  the 0.2.x thresholds exactly).
- The long volume window spans task boundaries (context pressure does not
  reset on a new command); the short error window is epoch-scoped (a new
  task starts from zero error evidence; `carry` is the cross-task channel).

### Removed

- **Hysteresis** (`stabilize`, `stabilizeEffort`): with a 6-step decaying
  window the evidence itself ages out fast enough. The `downAfter` config
  key stays in the schema so old config files still validate; its value is
  ignored.
- **Todo text as classification evidence** (`activeTodoText`, the
  `todosSignal` knob): a todo list is only a rearrangement of the origin
  brief, not independent evidence. The todo COMPLETION event remains as a
  channel-① bump.
- The `toolCallClass` scoring branch: classification happens at the origin,
  before any tool call exists.
- The `briefVolumeAt`/`briefVolumeBig`/`toolVolumeAt`/`toolVolumeBig`/
  `toolWindow` scoring keys: superseded by `briefRamp`/`toolRamp`/
  `longWindow`.

### Fixed

- **The phantom-manual lock** (present since 0.2.0; 103 locked sessions in
  the field log): the selection-echo guard read ANY non-null
  `modelSelection.pending` as "a durable human pick" — including this
  plugin's OWN `markAutoPending` 'auto' stamp — so from step 2 onward the
  host's mirrored concrete seed (confirmed host semantics: the in-memory
  request selection follows the last stamped header; `pending` holds the
  durable intent) was recorded `manual`, and every later step inherited
  the lock. The badge showed 手动 while the selector showed Auto and the
  scheduler was bypassed entirely. The guard now reads three pending
  states: a CONCRETE effort is a real pick (never an echo); `'auto'` is
  durable AUTO intent (a UI Auto pick or our stamp) and any concrete seed
  on the same route is definitionally the mirror; `null` falls back to
  the decision-store witness as before. Locked sessions un-break on the
  next step (their pending persisted `'auto'`), and the auto stamp is now
  idempotent.

## [0.2.7-rc.8] - 2026-10-14

### Added

- **Full dictionary replacement: `dictStrong` / `dictNormal` / `dictCheap` /
  `dictWish` config keys** (strings, one cue per line or comma-separated,
  remount on change). When non-blank, the list IS the whole dictionary — the
  shipped list is dropped, so users can REMOVE cues as well as add them; the
  matching `cues*` additions still merge on top. Blank (default) keeps the
  shipped dictionary, so existing configs are unaffected. Flows through a new
  `input.dictionaries` channel in `normalizePolicyConfig` (dodging the
  `input.wish` boolean/array name clash) with cue matchers recompiled only on
  actual change (the snapshot memo already covers the new keys).
- **`GET /effort-router/dictionaries` read-only route**: per list, the
  `effective` cues scheduling actually matches, the `builtin` reference, the
  active `override` (dict* replacement or null), and the `additions` (cues*).
  Read this before editing a `dict*` key.

## [0.2.7-rc.7] - 2026-10-14

### Added

- **`chatAnnotate` config key** (DEFAULT `false`, volatile): opts into
  per-tool-call `provider/model · effort` caption rows in the conversation
  view — the R1 surface revived on the maintainer's call, now fed by the
  existing `effortRouterAnchors` session projection (no new host projection).
  The client reads the flag once at load, so a toggle applies on page reload.
  Note: the 0.2.0 field note said this registration seam rendered nothing;
  whether it renders on the current host is open until verified with the flag
  on (see ROADMAP R1).

### Removed

- **The telemetry score (`scoreOf`) and its ~13 scoring-only weights.** No
  decision read the number since 0.2.0 (it existed "for one-version
  debugging", six versions ago); the `reason` array explains every decision
  better. `decideEffort` no longer returns `score`, and decision records/log
  lines drop the field. Weights that DO drive classification and escalation
  (`denseStrong*`, `bulletMinLines`, `toolCallClass`, `trivialTokenCap`,
  `wishTokenCap`, volume ladders, `toolWindow`) are untouched.

## [0.2.7-rc.6] - 2026-10-14

### Fixed

- **Trajectory boundary chip truncated longer captions with "…".** The rc.5
  fixed `max-width:190px` ellipsized real provider/model ids. The chip is now
  content-driven: it sizes to its text and only a generous guard
  (`min(80ch, 70vw)` — beyond any real caption) can still truncate, with the
  full caption always available in the chip's `title`.

### Added

- **`showBadge` config key** (default `true`, volatile): hides the read-only
  composer badge when set to `false`. Together with the existing
  `trajectoryAnnotate`, every GUI surface is now gated by its own config key.

### Removed

- **The settings card (`Settings → Effort Router`) is gone by design.** All
  user-facing options live in the plugin config file (profile-side, never
  overwritten by package upgrades) — edit it directly or ask your agent in
  natural language. The GUI keeps only read-only displays (badge, trajectory
  chips). The card had also rendered EMPTY in the maintainer's environment,
  evidence the configForms-bound UI path was already broken in practice.
- **The llm-pi-ai per-model effort editor** (part of the settings card).
  Per-model wire-value tables are edited directly in the `llm-pi-ai` config
  (`reasoningEfforts`, official-schema validated); the automatic,
  resolution-gated default fill is unchanged. The editor-only helpers
  (`withModelEfforts`, `validateEffortTable`, `normalizeEffortTable`,
  `isCustomGateway`) and the settings-card locales/styles went with it.
- **Dead field `vision`** in the capability resolver — resolved per model but
  never consumed anywhere.

### Changed

- **Config drift is now pinned by a test**: `DEFAULT_CONFIG` and the `Config`
  schema defaults are asserted key-by-key (both directions) so the two can no
  longer diverge silently.
- Client bundle shrinks to ~19.6 kB (from ~60.7 kB) with the card removed.

## [0.2.7-rc.5] - 2026-10-13

### Changed

- **Boundary-chip skin settled: `transparent`** (maintainer's pick after the
  rc.3/rc.4 A/B round). Text only, nothing painted behind it; the rejected
  `under` / `solid` / `gradient` skins remain commented in
  `src/client/styles.ts` and the localStorage `er.trj.variant` hook stays
  wired for any future revisit.

## [0.2.7-rc.4] - 2026-10-13

### Fixed

- **`under` skin was invisible.** A bare `z-index:-1` sank below the table
  pane's own background. The event cell now gets `isolation:isolate` (via a
  version-proof attribute selector, no hashed native class names), so the
  chip paints at the bottom of the CELL's content stack — below the in-flow
  kind chips, above the pane background.
- **`gradient` band retuned.** The solid band now hugs the row separator:
  ~2px full-solid core with ~1.8px ramps (transparent outside the middle
  ~4px of the 15px box) instead of the rc.3 wide solid window.

### Removed

- **`slim` skin** (rejected on aesthetics).

## [0.2.7-rc.3] - 2026-10-13

### Changed

- **Boundary-chip skin A/B build (style only).** The rc.2 solid chip
  straddles the row boundary 15px tall and clips ~1-2px of the neighbouring
  native kind chips. The skin is now switchable via localStorage
  `er.trj.variant` (reload to apply), default `under`:
  - `under` — solid chip painted BELOW the in-flow kind chips (cell-content
    paint order keeps it above row backgrounds): the native chips keep their
    edge pixels.
  - `solid` — the rc.2 look, fully on top (control).
  - `transparent` — text only, nothing painted behind it.
  - `gradient` — solid centre fading to transparent at the top/bottom edges:
    the row separator never strikes the text and the chip covers nothing of
    the neighbouring chips (one small GPU texture per chip; no measurable
    repaint cost at ledger scale).
  - `slim` — 8px font in an 11px box, shrunk into the ~12px boundary zone so
    it never reaches the kind chips.

## [0.2.7-rc.2] - 2026-10-13

### Fixed

- **Host starved by the merged-anchor fallback (0.2.7-rc.1 regression).**
  `anchorsOf` materialized anchor projections for EVERY session in the
  decision store before capping to the most recent ones, and `stateOf()` may
  replay a session's event log — on busy profiles the 2.5 s trajectory poll
  stalled the host long enough that history paging (chat and trajectory
  views) could not load older turns. The route now dedupes, sorts, and caps
  session candidates WITHOUT touching projections, then folds anchors for
  the capped few only.
- **Trajectory capsules moved to the native request dot.** The capsule now
  rides the ledger's own "请求 #N" request-boundary control as a tiny 9px
  chip straddling the row boundary — `#N · provider/model · effort` visible
  without hover, and clicking the chip forwards to the dot so the native
  request summary still opens. Rows whose step renders no dot keep the
  previous inline caption. Placement mirrors the host's source contract:
  step groups open with their assistant record, so the dot always lands on
  the assistant row our anchors already key (no host package touched).
- **Cross-session capsule flash (~0.5 s).** Row keys collide across sessions
  and React reuses row elements for equal keys, so a just-switched ledger
  could keep the previous session's capsules for up to one poll interval.
  The decorator now re-reads the route on every mutation batch; a session
  change clears every caption and blanks the cached table synchronously, so
  reused rows go bare (never wrong) until the next poll. Row-key attribute
  changes also invalidate the per-row caches immediately, and a
  cached-but-disconnected caption now forces a re-mount instead of being
  suppressed by the idempotence marker.

## [0.2.7-rc.1] - 2026-10-13

### Fixed

- **Trajectory capsules could attribute the wrong session in merged mode.**
  Assistant anchor keys are per-session `turn/step` coordinates and collide
  across sessions; when the shell URL carries no session id, the merged
  fallback let `Object.assign` decide whose capsule painted a colliding row —
  a deepseek-flash session showed the capsules of an unrelated kimi-k3
  session (masked until 0.2.7-rc.1 by single-model usage: every colliding
  table said the same model). The client now sends one visible tool call id
  as a `hint` — call ids are globally unique — and the route answers with the
  owning session's own table (`anchorsResolved: "hint"` in the state payload);
  without a hint the merge runs oldest → newest so the most recently active
  session wins collisions. Resolution logic lives in the pure, unit-tested
  `lib/anchors-resolve.js`. The client anchor-table fingerprint is now a
  content hash, so a same-sized table swap (session switch) triggers a full
  re-decoration instead of keeping the previous session's capsules.

## [0.2.6] - 2026-10-13

Lands the 2026-10-09 dictionary & parameter audit
(`docs/ops/2026-10-09-词典与参数统计审计建议报告.md` + the T6 dictionary
recommendations that supersede its §6; six-harness, 200k-event corpus) and a
trajectory-rendering performance pass.

### Fixed

- **Tool evidence channel was blind on DSH v4 sessions (audit R1, P0).** The
  collector folded tool results only out of v0/v3 user-role messages carrying
  `tool-result` blocks; current DSH derives them as first-class
  `role: "tool"` messages (message-level `isError`, plain text blocks), so
  the sliding window's error and volume counters stayed at 0 and
  `escalateOnErrors` / the volume ladders never fired. `scanFresh` gained the
  v4 branch, with a new message-level `toolErrorOfMessage` (the block-level
  `toolErrorsOf` stays for replayed pre-v4 logs; the two shapes are mutually
  exclusive per session in the corpus and the watermark scans each message
  once, so no dedupe table is kept).
- **Trajectory capsules painted ~300 ms late.** The decorator debounced every
  mutation by 250 ms and then re-scanned the whole ledger with a per-row
  `querySelector`. Decoration is now incremental (observer collects only
  added rows) on the next animation frame, with per-row anchor ids and
  caption elements cached in WeakMaps; full re-registration happens only when
  the anchor table actually changes (fingerprint) plus a slow safety sweep,
  and rows leaving the ledger are dropped from the tracking sets.

### Changed

- **Error-text markers rebuilt (audit R2).** The single 0.2.x regex became
  four focused patterns — `[exit code: N]` (N≥1), a bare `Exit code: N` line,
  line-anchored English markers (Traceback/Errors:/Exception/FATAL/…), and
  CJK markers (错误/失败/异常/报错) that now require a following colon, digit,
  or end-of-line, so prose like "没有错误" no longer counts. A CJK-only hit on
  output that itself reports a zero exit code is demoted (not a failure).
- **`escalateOnErrors` default 2 → 1 (audit R4.1).** The first tool error
  already lifts the class one step; the second error reaches the +2 cap via
  the existing `onErrors*2` rung. (Settings card fallback display aligned.)
- **`trivialTokenCap` 60 → 200 (audit R4.4).** Real trivial-paste briefs
  cluster at 80–160 tokens; the 60 cap pushed them to standard.
- **Dictionaries to the T6 final lists (audit R3; counts verified):
  strong 97 / normal 29 / cheap 21 / wish 21.** `依赖`/`api`/`异常` migrate
  strong → normal (both signals leaned light); `一句话`/`define`/`是什么`
  migrate cheap → normal (heavy association conflicts with the trivial
  privilege); `计划`/`搜索`/`评估`/`环境`/`开发`/`负责` added to strong;
  `return only`/`bullet points` added to cheap. `wish` unchanged. The audit's
  own `解析` demotion (v2.3-R3) was revoked by T6 and is NOT applied.
- **Repeat-detection keys are order-stable (audit R4.6).** Tool-call argument
  JSON is canonicalized with sorted keys (`stableStringify`), so identical
  arguments emitted in a different key order still count as repeats;
  unparsable argument strings keep their raw spelling.

### Added

- **Decision-log observation fields (audit §10.3).** Scheduled decisions now
  record the actual `briefTokens` / `toolVolume`, the window counters
  `windowErrors` / `windowRepeats`, the frugal trigger (`frugal` /
  `frugalWhy`), and a new trailing-identical-tool-run signal
  `consecSameTool` — observation only, so the next audit cycle can judge
  whether "stuck on one tool" deserves its own escalation. Nothing here feeds
  back into decisions.

## [0.2.5-rc.1] - 2026-10-12

### Fixed

- **Assistant-row capsules never resolved (root cause of "no capsules at
  all").** The host anchor projection keyed assistant steps by `message.id`,
  but the trajectory view keys its assistant cells `assistant\0<turn>\0<step>`
  (trajectoryRecordId) — message rows never matched, which is why 0.2.4
  showed capsules only on tool rows and 0.2.5 (assistant-rows-only) showed
  none. The projection now keys message anchors by `assistant\0turn\0step`
  from the event's validated integer `data.turn`/`data.step`, falling back to
  `message.id` only for replayed logs that predate the validator; projection
  stateVersion bumped to 2.

## [0.2.5] - 2026-10-12

### Fixed

- **Capsule only on assistant rows, inline with the text.** Two live findings
  from the 0.2.4 rollout: (1) tool rows (data-kind="tool") also carried the
  capsule — now only assistant message rows (data-kind="message") are
  decorated, so the badge sits next to the purple 【助手】 chip exclusively.
  (2) The capsule was prepended BEFORE the content cell's text container
  (span.contentText is display:block), which put it on its own line above
  the row text and pushed the text down; it is now inserted INTO the text
  container as its first inline child, so badge and text share one line and
  the text shifts right.

## [0.2.4] - 2026-10-11

### Fixed

- **Idle sessions show no trajectory capsules.** The merged-anchors fallback
  enumerated only hook-fed `sessionRefs`, which holds sessions that fired an
  LLM hook in this runtime — a session merely OPENED from history was never
  in it. The route now enumerates the live `sessions` store (`ctx.sessions`
  `get`/`list`, which covers sessions restored by viewing them in the GUI)
  first, with `sessionRefs` as a supplement (deduped by session id).
- **Capsule overlapped the row text.** The 0.2.3 mount point sat inside the
  event cell, whose kind slot is a fixed-width flex box (76px / 44px zh), so
  the capsule overflowed onto the content text instead of pushing it. The
  caption now mounts as the first child of the CONTENT cell — visually right
  next to the purple 【助手】 badge — so the row's own text shifts right
  (margin moved from `margin-left` to `margin-right`).

## [0.2.3] - 2026-10-11

### Fixed

- **Trajectory capsule invisible + moved next to the role chip.** Two live-test
  findings from the 0.2.2 rollout: (1) the decorator derived the session id
  only from `location.href`, which the shell URL does not always carry — the
  poll never ran and nothing was decorated. The state route now answers
  session-less queries with a merged anchor table of the 8 most recent
  sessions (anchor keys are globally unique message/call ids, so merging is
  collision-safe and only the on-screen session's rows resolve), and the
  client polls with or without an id. (2) The caption now mounts right after
  the row's kind chip (`td [data-role-kind]` — the purple 助手 badge) instead
  of the last cell, with the old last-cell mount as fallback.

## [0.2.2] - 2026-10-11

### Added

- **Trajectory hoisting (`trajectoryAnnotate`, default on, volatile).** Each
  step's `provider/model · effort` is projected onto the NATIVE trajectory
  ledger rows — the assembly-layer route the community `dsh-trajectory-zh`
  plugin takes: a MutationObserver DOM projection keyed on the rows'
  `data-trajectory-row-key`, touching no host package and adding no view. The
  anchor table (`callId` / assistant `message.id` → provider/model/effort) is
  folded host-side by a new `effortRouterAnchors` session projection
  (capped at 500 anchors/session) and served on
  `GET /effort-router/state?sessionId=…`. This closes R4 without a panel:
  the information that was two menus deep (请求计时 → 选项) is now on the
  default ledger rows. A new switch in Settings → Effort Router disables it.

## [0.2.1] - 2026-10-11

### Added

- **`poisonRecovery` switch** (default on, volatile): disables the poisoned-history
  pin entirely on provably non-strict routes.

### Changed

- **Poison detection is provenance-gated, no longer shape-based.** The 0.2.0
  rule inferred "thinking was off" from any tool-call assistant turn without a
  reasoning block — but measured on kimi-K3 @ low (2026-10-10, session
  eb12fb23), thinking-ON tool steps routinely carry no reasoning block, so the
  rule false-pinned Auto to `off` after the first K3 tool loop. The pin now
  requires BOTH the shape suspect (a reasoning-less tool-call turn in history)
  AND decision-store proof of a manual `off` step in the same session; it
  still lifts on compaction. Signals expose the shape fact as
  `offShapeHistory` (was `poisonedHistory`).
- **The poison pin bypasses hysteresis.** In 0.2.0 the pinned `off` tier went
  through `stabilizeEffort`, which held the previous thinking-on tier for
  `downAfter` steps — sending exactly the request the pin exists to prevent.

### Removed

- **Chat-flow tool-call captions** (R1): the per-call `provider/model · effort`
  annotation surface (`src/client/annotations.ts`, the `conversation.chat.node`
  slot, `.er-call*` styles, `annotation.default` locale keys), the host-side
  `effortRouterRoute` session projection (`lib/route-projection.js`), and the
  `@deepseek-ai/dsh-client-ui-conversation` inject/peer entries. The per-step
  effort stays on every `request/header` session event for the host's
  trajectory view; the conversation flow is intentionally annotation-free.

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
