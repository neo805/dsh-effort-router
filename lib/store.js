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
  const warn = (message) => {
    if (logger && typeof logger.warn === 'function') logger.warn('[effort-router] ' + message)
  }
  // Prototype-safe session table: a session id of "__proto__" is ordinary data.
  let data = { version: 1, sessions: new Map() }
  const validRow = (row) => row !== null && typeof row === 'object' && !Array.isArray(row)
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      const rawSessions = parsed.sessions !== null && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
        ? parsed.sessions
        : null
      if (rawSessions && Object.keys(rawSessions).length > 0) {
        let skipped = 0
        for (const [id, row] of Object.entries(rawSessions)) {
          if (typeof id !== 'string' || !validRow(row)) { skipped += 1; continue }
          data.sessions.set(id, {
            last: validRow(row.last) ? row.last : null,
            recent: Array.isArray(row.recent) ? row.recent.filter(validRow) : [],
            manualOff: row.manualOff === true,
          })
        }
        if (skipped > 0) {
          warn('decision store skipped ' + skipped + ' malformed session row(s) in ' + file)
        }
      } else if (rawSessions) {
        // An empty sessions map is ordinary; anything else (string/array rows)
        // is not. Fall through to the per-row migration below.
      }
      // Migration: files written before the dedicated provenance flag kept the
      // proof only in `recent`. Recover it once so an active poison pin does not
      // disappear solely because this process restarted.
      for (const row of data.sessions.values()) {
        if (row.manualOff === true) continue
        if (row.recent.some((entry) => entry && entry.mode === 'manual' && entry.effort === 'off')) {
          row.manualOff = true
        }
      }
    }
  } catch (error) {
    // Absent files are the normal first run; unreadable/corrupt ones must be
    // visible, otherwise a permanently broken store looks like a plugin that
    // never decided anything.
    if (error && error.code !== 'ENOENT') {
      warn('decision store could not be read at ' + file + '; starting empty: '
        + String((error && error.message) || error))
    }
  }

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
      writeFileSync(tmp, JSON.stringify(serialize()))
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
  // Serialize the Map into a prototype-free object so an own "__proto__" key
  // survives JSON.stringify as data instead of being lost to the prototype.
  const serialize = () => {
    const sessions = Object.create(null)
    for (const [id, row] of data.sessions) sessions[id] = row
    return { version: 1, sessions }
  }
  const rowOf = (sessionId) => (typeof sessionId === 'string' && sessionId ? data.sessions.get(sessionId) : undefined)

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
      if (typeof sessionId !== 'string' || sessionId === '') return
      if (!validRow(entry)) return
      const row = rowOf(sessionId) || { last: null, recent: [] }
      row.last = entry
      row.recent = (Array.isArray(row.recent) ? row.recent : []).concat([entry]).slice(-DECISION_LIMIT)
      // Poison provenance is deliberately NOT part of the 20-decision ring:
      // a manual-off step must keep arming the pin until the offending history
      // shape is gone (or a new lifetime starts). The interceptor clears it
      // when offShapeHistory becomes false.
      if (entry.mode === 'manual' && entry.effort === 'off') row.manualOff = true
      data.sessions.set(sessionId, row)
      if (data.sessions.size > SESSION_LIMIT) {
        // Map iteration is insertion-ordered: drop the oldest sessions first.
        const excess = data.sessions.size - SESSION_LIMIT
        let dropped = 0
        for (const id of data.sessions.keys()) {
          if (dropped >= excess) break
          data.sessions.delete(id)
          dropped += 1
        }
      }
      dirty = true
      schedule()
    },
    /** The newest decision of a session, or undefined. */
    last(sessionId) {
      const row = rowOf(sessionId)
      return row && validRow(row.last) ? row.last : undefined
    },
    /** The retained decision list of a session (oldest first). */
    recent(sessionId) {
      const row = rowOf(sessionId)
      return row && Array.isArray(row.recent) ? row.recent : []
    },
    /** Has this session ever recorded a real manual-off step in the current shape epoch? */
    hadManualOff(sessionId) {
      const row = rowOf(sessionId)
      return !!row && row.manualOff === true
    },
    /** Compaction removed the offending shape: forget the old proof. */
    clearManualOff(sessionId) {
      const row = rowOf(sessionId)
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
