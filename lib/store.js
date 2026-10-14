/**
 * dsh-effort-router — durable decision log.
 *
 * Adapted from @neptune810/dsh-model-router v0.14.0 lib/store.js (MIT,
 * Copyright Neptune810), cut to one job: remember the last few routing
 * decisions per session so the composer badge survives a client reload, and
 * survive restarts for the read-only state route. Written atomically (tmp +
 * rename), debounced 250 ms; absent or corrupt files degrade to empty, and
 * nothing here can fail plugin load.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Decisions kept per session, and sessions kept in the file. */
const DECISION_LIMIT = 20
const SESSION_LIMIT = 200

/**
 * Resolve the state file. Precedence:
 *   1. an explicit profile directory (the host's `profileContext` service —
 *      the ONLY reliable profile identity inside a plugin fiber; DSH_PROFILE
 *      and friends are injected into tool sandboxes, not into plugin code);
 *   2. DSH_PROFILE_DIR (plain node hosts that export it);
 *   3. DSH_HOME/profiles/<DSH_PROFILE || 'web'>.
 * The 0.1.x/0.2.0 bug: without (1), a Desktop host fell through to the 'web'
 * default and SHARED the Web profile's state file — two instances racing one
 * tmp+rename writer.
 */
export function resolveStoreFile(env = typeof process === 'undefined' ? {} : process.env, profileDir) {
  if (typeof profileDir === 'string' && profileDir.length > 0) {
    return join(profileDir, '.effort-router', 'state.json')
  }
  const home = env.DSH_HOME || join(env.USERPROFILE || env.HOME || '.', '.dsh')
  const dir = env.DSH_PROFILE_DIR || join(home, 'profiles', env.DSH_PROFILE || 'web')
  return join(dir, '.effort-router', 'state.json')
}

/** Open (or create) the store. Never throws. */
export function createStore(file = resolveStoreFile(), logger) {
  let data = { version: 1, sessions: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      data = {
        version: 1,
        sessions: { ...(parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {}) },
      }
    }
  } catch (_absentOrCorrupt) { /* defaults */ }

  let timer
  let warned = false
  const flush = () => {
    timer = undefined
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      writeFileSync(tmp, JSON.stringify(data, null, 2))
      renameSync(tmp, file)
    } catch (error) {
      // In-memory state still serves the session; persistence is advisory, but
      // a failing write must be VISIBLE once (a permanently unwritable store
      // otherwise looks exactly like a plugin that never ran).
      if (!warned && logger && typeof logger.warn === 'function') {
        warned = true
        logger.warn('[effort-router] decision store is not writable at ' + file
          + '; decisions stay in memory for this run: ' + String((error && error.message) || error))
      }
    }
  }
  const schedule = () => {
    if (timer !== undefined) return
    timer = setTimeout(flush, 250)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  return {
    file,
    /**
     * Append one decision for a session. Entry: { at, turn, step, mode, effort,
     * tier, stepClass, reason, plus the observation fields originClass, warmup,
     * briefTokens, briefEffective, briefVolume, briefVolumeRaw, toolVolume,
     * toolVolumeRaw, windowErrors, windowRepeats, weightedErrors,
     * weightedRepeats, todoBump, carry, consecSameTool, frugal, frugalWhy } —
     * all JSON scalars. The observation fields are telemetry for the next
     * calibration cycle; no decision reads them back.
     */
    record(sessionId, entry) {
      if (!sessionId) return
      const sessions = data.sessions
      const row = sessions[sessionId] || { last: null, recent: [] }
      row.last = entry
      row.recent = (Array.isArray(row.recent) ? row.recent : []).concat([entry]).slice(-DECISION_LIMIT)
      sessions[sessionId] = row
      const ids = Object.keys(sessions)
      if (ids.length > SESSION_LIMIT) {
        for (const id of ids.slice(0, ids.length - SESSION_LIMIT)) delete sessions[id]
      }
      schedule()
    },
    /** The newest decision of a session, or undefined. */
    last(sessionId) {
      const row = sessionId ? data.sessions[sessionId] : undefined
      return row && row.last ? row.last : undefined
    },
    /** The retained decision list of a session (oldest first). */
    recent(sessionId) {
      const row = sessionId ? data.sessions[sessionId] : undefined
      return row && Array.isArray(row.recent) ? row.recent : []
    },
    flush,
  }
}
