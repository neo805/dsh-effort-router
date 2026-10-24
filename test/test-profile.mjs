/**
 * Per-test-process profile isolation.
 *
 * `apply()` resolves the decision store from `profileContext` (absent in these
 * unit hosts) or the environment. Without this module, any `apply()` test that
 * outlives the 250 ms store debounce writes synthetic sessions into the REAL
 * profile's `.effort-router/state.json` and can clobber live decisions. Node's
 * test runner gives every test FILE its own process, so setting the variable
 * once at module load isolates the whole file without touching test bodies.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TEST_PROFILE_DIR = mkdtempSync(join(tmpdir(), 'er-test-profile-'))
process.env.DSH_PROFILE_DIR = TEST_PROFILE_DIR

export const TEST_STORE_FILE = join(TEST_PROFILE_DIR, '.effort-router', 'state.json')