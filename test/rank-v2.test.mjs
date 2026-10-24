/**
 * 0.2.16 integer effort-rank contracts.
 *
 * The four origin classes remain labels. Drift, ceilings, the second-layer
 * allow-list quantizer and unknown-selector normalization all operate on the
 * canonical integer ranks 1..7 (0 is off/none, reserved for safety paths).
 */
import './test-profile.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ROUTES,
  POLICY_DEFAULTS,
  decideEffort,
  normalizePolicyConfig,
} from '../lib/policy.js'
import {
  effortForRank,
  mapEffort,
  normalizeEfforts,
  rankOf,
} from '../lib/routing.js'
import * as entry from '../lib/index.js'

test('normalizePolicyConfig: default origin anchors become integer ranks', () => {
  const cfg = normalizePolicyConfig({})
  assert.deepEqual(cfg.routeRanks, { trivial: 2, standard: 2, engineering: 4, hard: 6 })
  assert.equal(cfg.ceilingRank, 6, 'the default hard anchor is the ceiling')
  assert.equal(cfg.allowedRanks, null, 'absent allow-list means every advertised level')
  assert.equal(cfg.effortFallback, 'nearest-up')
  assert.deepEqual(cfg.routes, DEFAULT_ROUTES)
})

test('normalizePolicyConfig: routes accept every non-off canonical level', () => {
  const extended = normalizePolicyConfig({
    routes: { trivial: 'minimal', standard: 'low', engineering: 'xhigh', hard: 'ultra' },
  })
  assert.deepEqual(extended.routeRanks, { trivial: 1, standard: 2, engineering: 5, hard: 7 })
  assert.equal(extended.ceilingRank, 7, 'hard=ultra opens the extension ceiling')
  assert.deepEqual(extended.routes, {
    trivial: 'minimal', standard: 'low', engineering: 'xhigh', hard: 'ultra',
  })
})

test('normalizePolicyConfig: non-monotonic origin anchors are rejected loudly', () => {
  const cfg = normalizePolicyConfig({
    routes: { trivial: 'max', standard: 'low', engineering: 'high', hard: 'max' },
  })
  assert.match(cfg.routeError, /non-decreasing/)
  assert.deepEqual(cfg.routes, DEFAULT_ROUTES, 'invalid cross-field routes fall back as a whole')
  assert.deepEqual(cfg.routeRanks, { trivial: 2, standard: 2, engineering: 4, hard: 6 })
})

test('normalizePolicyConfig: non-off routes cannot be off/auto/none', () => {
  const cfg = normalizePolicyConfig({
    routes: { trivial: 'off', standard: 'auto', engineering: 'none', hard: 'max' },
  })
  assert.deepEqual(cfg.routes, { trivial: 'low', standard: 'low', engineering: 'high', hard: 'max' })
  assert.equal(cfg.ceilingRank, 6)
})

test('normalizePolicyConfig: drifted targets are ranks, not classes', () => {
  const cfg = normalizePolicyConfig({})
  const standard = decideEffort(cfg, { originClass: 'standard', weightedErrors: 1 })
  assert.equal(standard.targetRank, 3)
  assert.equal(standard.targetTier, 'medium')
  assert.equal(standard.tier, 'medium')
  assert.equal(standard.stepClass, null, 'no synthetic post-drift class is fabricated')

  const trivial = decideEffort(cfg, { originClass: 'trivial', weightedErrors: 1 })
  assert.equal(trivial.targetRank, 3, 'trivial +1 is now a real rank step, subject to its cap')

  const engineering = decideEffort(cfg, { originClass: 'engineering', weightedErrors: 1 })
  assert.equal(engineering.targetRank, 5)
  assert.equal(engineering.targetTier, 'xhigh')

  const hard = decideEffort(cfg, { originClass: 'hard', weightedErrors: 2 })
  assert.equal(hard.targetRank, 6, 'the hard anchor remains the default ceiling')
})

test('decideEffort: frugal demotes one rank and warm-up floors at the origin', () => {
  const cfg = normalizePolicyConfig({})
  const afterWarmup = decideEffort(cfg, {
    originClass: 'engineering', frugal: true, frugalWhy: 'subagent',
  })
  assert.equal(afterWarmup.targetRank, 3)
  assert.equal(afterWarmup.targetTier, 'medium')

  const duringWarmup = decideEffort(cfg, {
    originClass: 'engineering', frugal: true, frugalWhy: 'subagent', warmup: true,
  })
  assert.equal(duringWarmup.targetRank, 4)
  assert.equal(duringWarmup.targetTier, 'high')
})

test('decideEffort: extended hard anchor raises the ceiling', () => {
  const cfg = normalizePolicyConfig({
    routes: { trivial: 'low', standard: 'low', engineering: 'xhigh', hard: 'xhigh' },
  })
  const d = decideEffort(cfg, { originClass: 'hard', weightedErrors: 2 })
  assert.equal(d.targetRank, 5, 'rank drift clamps at the configured hard anchor')
  assert.equal(d.targetTier, 'xhigh')
})

test('allowedEfforts: new global allow-list; legacy keys migrate or conflict', () => {
  const restricted = normalizePolicyConfig({ allowedEfforts: ['low', 'high', 'max'] })
  assert.deepEqual(restricted.allowedRanks, [2, 4, 6])
  assert.equal(restricted.deprecatedAllowMax, false)

  const migrated = normalizePolicyConfig({ allowMax: false, maxFallback: 'high' })
  assert.deepEqual(migrated.allowedRanks, [1, 2, 3, 4], 'legacy fallback becomes a rank ceiling')
  assert.equal(migrated.deprecatedAllowMax, true)
  assert.equal(migrated.configConflict, null)

  const conflict = normalizePolicyConfig({
    allowedEfforts: ['low', 'high'],
    allowMax: false,
    maxFallback: 'low',
  })
  assert.match(conflict.configConflict, /allowMax/)
  assert.deepEqual(conflict.allowedRanks, [2, 4], 'the explicit new allow-list wins, with a warning')

  const withReserved = normalizePolicyConfig({ allowedEfforts: ['auto', 'off', 'low', 'none'] })
  assert.deepEqual(withReserved.allowedRanks, [2], 'reserved sentinels never enter normal Auto')
  assert.match(withReserved.allowedError, /reserved/)
})

test('normalizeEfforts: known ids keep canonical ranks; unknown ids use order', () => {
  const known = normalizeEfforts(['off', 'low', 'medium', 'high', 'max', 'auto'])
  assert.deepEqual(known.items.map((x) => [x.id, x.rank]), [
    ['off', 0], ['low', 2], ['medium', 3], ['high', 4], ['max', 6],
  ])
  assert.deepEqual(known.unknown, [])
  assert.equal(known.items.some((x) => x.id === 'auto'), false)

  const mixed = normalizeEfforts(['off', 'low', 'super', 'max'])
  const superItem = mixed.items.find((x) => x.id === 'super')
  assert.equal(superItem.rank, 4, 'between low(2) and max(6)')
  assert.deepEqual(mixed.unknown, ['super'])

  const allUnknown = normalizeEfforts(['alpha', 'beta', 'gamma'])
  assert.deepEqual(allUnknown.items.map((x) => x.rank), [1, 4, 7],
    'with no anchors the ordered vocabulary spans the usable rank range')

  const beforeKnown = normalizeEfforts(['super', 'low'])
  assert.equal(beforeKnown.items[0].rank, 1, 'a leading unknown sits one step below its next anchor')
  const afterKnown = normalizeEfforts(['high', 'mega'])
  assert.equal(afterKnown.items[1].rank, 5, 'a trailing unknown sits one step above its previous anchor')
})

test('effortForRank: up/down are directional with boundary clamping', () => {
  const levels = ['low', 'high', 'max']
  const up = effortForRank(3, levels, { fallback: 'up' })
  assert.equal(up.effort, 'high')
  assert.equal(up.mapping, 'up')
  const down = effortForRank(3, levels, { fallback: 'down' })
  assert.equal(down.effort, 'low')
  assert.equal(down.mapping, 'down')
  const nearest = effortForRank(3, levels, { fallback: 'nearest-up' })
  assert.equal(nearest.effort, 'high', 'the compatibility mode ties upward')
  assert.equal(effortForRank(1, levels, { fallback: 'down' }).effort, 'low', 'bottom clamp')
  assert.equal(effortForRank(7, levels, { fallback: 'up' }).effort, 'max', 'top clamp')

  const allowed = effortForRank(3, levels, { allowedRanks: [4], fallback: 'down' })
  assert.equal(allowed.effort, 'high', 'down finds no lower allowed level, clamps to the lowest allowed')
  assert.equal(effortForRank(3, levels, { allowedRanks: [6], fallback: 'up' }).effort, 'max')
  assert.equal(effortForRank(3, levels, { allowedRanks: [6], fallback: 'down' }).effort, 'max')
})

test('effortForRank: exact target wins; reserved auto is never selected', () => {
  assert.equal(effortForRank(4, ['low', 'high', 'max', 'auto']).effort, 'high')
  assert.equal(effortForRank(3, ['low', 'auto']).effort, 'low')
  assert.equal(effortForRank(2, ['auto']).effort, undefined)
  assert.equal(mapEffort('medium', ['low', 'high', 'auto']), 'high',
    'the old public mapper keeps nearest-up but never returns auto')
})

test('quantizer matrix: every rank × fallback stays inside the allow-list', () => {
  const levels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const allowedSets = [null, [2, 4, 6], [1], [2, 4]]
  for (const allowedRanks of allowedSets) {
    for (const fallback of ['nearest-up', 'up', 'down']) {
      for (let target = 1; target <= 7; target += 1) {
        const result = effortForRank(target, levels, { allowedRanks, fallback })
        if (allowedRanks === null && target === 7) {
          assert.equal(result.effort, 'max', 'the top target clamps to the advertised maximum')
          continue
        }
        assert.ok(result.effort, fallback + ' rank ' + target + ' allowed=' + String(allowedRanks))
        if (allowedRanks === null) continue
        assert.ok(allowedRanks.includes(result.rank), 'the result never leaves the allow-list')
        if (fallback === 'up') {
          const higher = allowedRanks.filter((rank) => rank >= target)
          if (higher.length > 0) assert.ok(result.rank >= target)
          else assert.equal(result.rank, Math.max(...allowedRanks), 'top boundary clamps to highest allowed')
        }
        if (fallback === 'down') {
          const lower = allowedRanks.filter((rank) => rank <= target)
          if (lower.length > 0) assert.ok(result.rank <= target)
          else assert.equal(result.rank, Math.min(...allowedRanks), 'bottom boundary clamps to lowest allowed')
        }
      }
    }
  }
})

test('Config exposes the new global controls and keeps legacy keys', () => {
  const resolved = entry.Config({})
  assert.deepEqual(resolved.allowedEfforts, [])
  assert.equal(entry.readVolatile(resolved.effortFallback, 'nearest-up'), 'nearest-up')
  assert.equal(resolved.routes.engineering, 'high')
  assert.equal(entry.readVolatile(resolved.allowMax, true), true)
  assert.equal(entry.readVolatile(resolved.maxFallback, 'high'), 'high')
  assert.equal(entry.DEFAULT_CONFIG.allowedEfforts.length, 0)
  assert.equal(entry.DEFAULT_CONFIG.effortFallback, 'nearest-up')

  const extended = entry.Config({
    routes: { trivial: 'minimal', standard: 'low', engineering: 'xhigh', hard: 'ultra' },
    allowedEfforts: ['low', 'high', 'max'],
    effortFallback: 'down',
  })
  assert.equal(extended.routes.hard, 'ultra')
  assert.equal(extended.effortFallback, 'down')
})