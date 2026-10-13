# Changelog

All notable changes to dsh-effort-router are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

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
