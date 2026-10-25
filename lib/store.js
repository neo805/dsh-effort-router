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
      // Migration: files written before the dedicated provenance flag kept the
      // proof only in `recent`. Recover it once so an active poison pin does not
      // disappear solely because this process restarted.
      for (const row of Object.values(data.sessions)) {
        if (!row || typeof row !== 'object' || row.manualOff === true) continue
        if (Array.isArray(row.recent)
          && row.recent.some((entry) => entry && entry.mode === 'manual' && entry.effort === 'off')) {
          row.manualOff = true
        }
      }
    }
  } catch (_absentOrCorrupt) { /* defaults */ }

  let timer
  let warned = false
  let dirty = false
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!dirty) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      // Compact JSON: the file is machine-owned, and the pretty-printed copy
      // measurably doubles the bytes and serialization time at the 200×20 cap.
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, file)
      dirty = false
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
     * tier, targetTier, targetRank, mapping, stepClass, reason, plus the
     * observation fields originClass, warmup,
     * briefTokens, briefEffective, briefVolume, briefVolumeRaw, toolVolume,
     * toolVolumeRaw, windowErrors, windowRepeats, weightedErrors,
     * weightedRepeats, errorSources, contextPressure, sessionTokens,
     * projectionsAvailable, contextPressureAvailable, tokenUsageAvailable,
     * todosAvailable, todosCount, todoTransitions, todoBump,
     * carry, consecSameTool, frugal, frugalWhy }. Values are JSON scalars except
     * `errorSources`, a flat count map over the fixed source vocabulary. The
     * observation fields are telemetry for the next calibration cycle; no
     * decision reads them back. A manual/off entry also sets the session-level
     * `manualOff` provenance flag, which outlives the 20-entry recent ring.
     */
    record(sessionId, entry) {
      if (!sessionId) return
      const sessions = data.sessions
      const row = sessions[sessionId] || { last: null, recent: [] }
      row.last = entry
      row.recent = (Array.isArray(row.recent) ? row.recent : []).concat([entry]).slice(-DECISION_LIMIT)
      // Poison provenance is deliberately NOT part of the 20-decision ring:
      // a manual-off step must keep arming the pin until the offending history
      // shape is gone (or a new lifetime starts). The interceptor clears it
      // when offShapeHistory becomes false.
      if (entry.mode === 'manual' && entry.effort === 'off') row.manualOff = true
      sessions[sessionId] = row
      const ids = Object.keys(sessions)
      if (ids.length > SESSION_LIMIT) {
        for (const id of ids.slice(0, ids.length - SESSION_LIMIT)) delete sessions[id]
      }
      dirty = true
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
    /** Has this session ever recorded a real manual-off step in the current shape epoch? */
    hadManualOff(sessionId) {
      const row = sessionId ? data.sessions[sessionId] : undefined
      return !!row && row.manualOff === true
    },
    /** Compaction removed the offending shape: forget the old proof. */
    clearManualOff(sessionId) {
      const row = sessionId ? data.sessions[sessionId] : undefined
      if (!row || row.manualOff !== true) return
      row.manualOff = false
      dirty = true
      schedule()
    },
    flush,
    /** Cancel the pending debounce and persist one last decision, if any. */
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      flush()
    },
  }
}
