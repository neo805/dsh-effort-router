/**
 * store.js unit tests — store path resolution (the cross-profile race fix)
 * and a flush roundtrip.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, resolveStoreFile } from '../lib/store.js'

test('resolveStoreFile: an explicit profileContext dir wins over every env', () => {
  const file = resolveStoreFile({ DSH_HOME: '/h', DSH_PROFILE: 'web', DSH_PROFILE_DIR: '/h/profiles/web' }, '/h/profiles/desktop')
  assert.equal(file, join('/h/profiles/desktop', '.effort-router', 'state.json'))
})

test('resolveStoreFile: DSH_PROFILE_DIR is the env fallback', () => {
  const file = resolveStoreFile({ DSH_PROFILE_DIR: '/h/profiles/desktop', DSH_HOME: '/h' })
  assert.equal(file, join('/h/profiles/desktop', '.effort-router', 'state.json'))
})

test('resolveStoreFile: DSH_PROFILE name, then the web default', () => {
  assert.equal(
    resolveStoreFile({ DSH_HOME: '/h', DSH_PROFILE: 'desktop' }),
    join('/h', 'profiles', 'desktop', '.effort-router', 'state.json'),
  )
  assert.equal(
    resolveStoreFile({ DSH_HOME: '/h' }),
    join('/h', 'profiles', 'web', '.effort-router', 'state.json'),
  )
})

test('createStore: record flushes to disk and reloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-store-'))
  const file = join(dir, 'state.json')
  const store = createStore(file, { info() {}, warn() {} })
  store.record('s1', { at: 1, turn: 1, step: 1, mode: 'auto', effort: 'high' })
  store.flush()
  assert.ok(existsSync(file))
  const reopened = createStore(file, { info() {}, warn() {} })
  assert.equal(reopened.last('s1').effort, 'high')
  assert.equal(reopened.recent('s1').length, 1)
  // corrupt files degrade to empty, never throw
  const corrupt = join(dir, 'corrupt.json')
  const bad = createStore(corrupt, { info() {}, warn() {} })
  assert.equal(bad.last('nope'), undefined)
})

test('createStore: compact JSON and dispose flush the last decision exactly once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-store-dispose-'))
  const file = join(dir, 'state.json')
  const store = createStore(file, { info() {}, warn() {} })
  store.record('s1', { at: 1, turn: 1, step: 1, mode: 'auto', effort: 'low' })
  store.dispose()
  const text = readFileSync(file, 'utf8')
  assert.equal(text.includes('\n  "'), false, 'the store is compact JSON, not pretty-printed')
  const reopened = createStore(file, { info() {}, warn() {} })
  assert.equal(reopened.last('s1').effort, 'low', 'dispose performs the final durable write')
  store.dispose()
  assert.equal(store.last('s1').effort, 'low', 'a repeated dispose is safe')
})

test('createStore: an unwritable path warns ONCE and keeps serving in memory', () => {
  // A plain FILE where the store needs a directory: mkdirSync fails with
  // ENOTDIR, which is the "profile dir is not writable" class of failure.
  const dir = mkdtempSync(join(tmpdir(), 'er-store-blocked-'))
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a directory')
  const warns = []
  const store = createStore(join(blocker, 'state.json'), { info() {}, warn: (m) => warns.push(m) })
  store.record('s1', { at: 1, turn: 1, step: 1, mode: 'auto', effort: 'low' })
  store.flush()
  assert.equal(warns.length, 1, 'a permanently unwritable store must be visible')
  assert.match(warns[0], /decision store is not writable/)
  // In-memory state still answers, and the warning is not repeated every flush.
  assert.equal(store.last('s1').effort, 'low')
  store.record('s1', { at: 2, turn: 1, step: 2, mode: 'auto', effort: 'high' })
  store.flush()
  assert.equal(warns.length, 1, 'the warning fires once per run, not per write')
  assert.equal(store.last('s1').effort, 'high')
})
