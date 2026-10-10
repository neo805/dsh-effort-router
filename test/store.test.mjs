/**
 * store.js unit tests — store path resolution (the cross-profile race fix)
 * and a flush roundtrip.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
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
