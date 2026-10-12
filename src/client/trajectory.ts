/**
 * dsh-effort-router — native trajectory hoisting (DOM projection).
 *
 * The same route the community dsh-trajectory-zh plugin takes: an
 * assembly-layer client bundle + a MutationObserver DOM projection on the
 * NATIVE trajectory tab — no host package is touched and no new view is
 * added. The trajectory ledger keys every row (data-trajectory-row-key) with
 * anchors we can resolve against the host's effort-anchor table
 * (GET /effort-router/state?sessionId=… → anchors):
 *
 *   - tool rows:      encodeURIComponent('tool\0call\0<callId>')
 *   - message rows:   encodeURIComponent(<assistant message id>)
 *
 * Assistant message rows (data-kind="message") that resolve to an anchor
 * gain a compact caption `provider/model · effort` inline at the start of
 * the row's text — visually right next to the row's kind chip (the purple
 * 助手 badge) — and the row's own text shifts right to make room; tool rows
 * and rows that resolve to nothing stay untouched. Everything is
 * idempotent (rows are keyed, captions carry a marker) and degrades to a
 * no-op outside the trajectory tab or when the host route reports
 * trajectoryAnnotate: false. When the shell URL carries no session id the
 * host route answers with a merged anchor table of the most recent sessions
 * (anchor keys are globally unique, so only the on-screen session's rows
 * resolve).
 *
 * 0.2.6 performance rewrite (measured ~300 ms to first full caption paint on
 * a busy ledger, now one animation frame):
 *   - the old 250 ms decorate DEBOUNCE is gone: row mutations are decorated
 *     on the next requestAnimationFrame (~16 ms), which also batches bursts;
 *   - decoration is INCREMENTAL: the observer collects only newly added rows
 *     (subtree-scoped), instead of re-scanning the whole ledger each pass;
 *   - per-row anchor ids and caption elements are cached in WeakMaps — no
 *     repeated decodeURIComponent and no per-row querySelector;
 *   - full re-registration happens only when the anchor table actually
 *     changes (fingerprint), plus a slow sweep as a safety net; anchor-table
 *     updates re-resolve just the rows that have no caption yet.
 */

const POLL_MS = 2500
/** Every Nth successful poll forces a full re-registration (safety net). */
const FULL_SWEEP_EVERY = 8
const CAPTION_ATTR = 'data-er-trj'
const DONE_ATTR = 'data-er-trj-done'

interface AnchorsState {
  enabled: boolean
  anchors: Record<string, { provider: string | null; model: string | null; effort: string | null }>
}

/** The session id the web client is currently showing, from the route. */
function currentSessionId(): string | null {
  if (typeof location === 'undefined') return null
  const match = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(
    location.href,
  )
  return match ? match[0] : null
}

/** Resolve one row's DOM key to an anchor id (callId or message id). */
function anchorOf(rowKey: string): string | null {
  let key: string
  try {
    key = decodeURIComponent(rowKey)
  } catch {
    return null
  }
  const toolPrefix = 'tool\0call\0'
  if (key.startsWith(toolPrefix)) return key.slice(toolPrefix.length)
  return key || null
}

export function startTrajectoryDecorator(): () => void {
  let stopped = false
  let anchors: AnchorsState = { enabled: false, anchors: {} }
  let fingerprint = ''
  let polls = 0
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let sessionId: string | null = null

  /** Rows queued for decoration on the next animation frame. */
  const pendingRows = new Set<HTMLElement>()
  /** Decorated rows with no anchor yet — re-resolved when the table updates. */
  const unresolvedRows = new Set<HTMLElement>()
  /** Rows currently carrying a caption — revisited when annotation toggles off. */
  const labeledRows = new Set<HTMLElement>()
  /** Per-row caches: DOM key → anchor id, row → caption element. */
  const anchorIds = new WeakMap<HTMLElement, string | null>()
  const captions = new WeakMap<HTMLElement, HTMLElement>()
  let rafId: number | undefined

  const labelOf = (anchor: { provider: string | null; model: string | null; effort: string | null }) => {
    const provider = anchor.provider ? String(anchor.provider) : ''
    const model = anchor.model ? String(anchor.model) : ''
    const route = provider && model ? provider + '/' + model : model || provider
    const effort = anchor.effort === null || anchor.effort === undefined || anchor.effort === ''
      ? 'default'
      : String(anchor.effort)
    return route ? route + ' · ' + effort : ''
  }

  const anchorIdOf = (tr: HTMLElement): string | null => {
    let id = anchorIds.get(tr)
    if (id === undefined) {
      id = anchorOf(tr.getAttribute('data-trajectory-row-key') || '')
      anchorIds.set(tr, id)
    }
    return id
  }

  // Mount: INSIDE the content cell's text container (td.content >
  // span.contentText — display:block holding inline spans). Inserting before
  // that block container puts the caption on its own line ABOVE the row
  // text; inserting INTO it keeps the caption on the same line, visually
  // right of the 【助手】 badge, pushing the row's own text right.
  const mountCaption = (tr: HTMLElement, caption: HTMLElement) => {
    const cell = tr.querySelector('td:last-child')
    const target = (cell && cell.firstElementChild) ?? cell ?? tr
    target.insertAdjacentElement('afterbegin', caption)
  }

  const decorateRow = (tr: HTMLElement) => {
    // Only assistant message rows carry the caption: tool rows are already
    // attributed to the step that produced them, and the badge belongs next
    // to the purple 【助手】 chip.
    const isAssistantRow = (tr.getAttribute('data-kind') || '') === 'message'
    const anchorId = isAssistantRow ? anchorIdOf(tr) : null
    const anchor = anchorId !== null && anchors.enabled ? anchors.anchors[anchorId] : undefined
    const label = anchor ? labelOf(anchor) : ''
    if (tr.getAttribute(DONE_ATTR) !== label) {
      tr.setAttribute(DONE_ATTR, label)
      let caption = captions.get(tr)
      if (!label) {
        if (caption) {
          caption.remove()
          captions.delete(tr)
        }
      } else {
        if (!caption) {
          caption = document.createElement('span')
          caption.setAttribute(CAPTION_ATTR, '')
          caption.setAttribute('class', 'er-trj')
          captions.set(tr, caption)
          mountCaption(tr, caption)
        }
        caption.setAttribute('title', label)
        if (caption.textContent !== label) caption.textContent = label
      }
    }
    if (label) {
      unresolvedRows.delete(tr)
      labeledRows.add(tr)
    } else {
      labeledRows.delete(tr)
      unresolvedRows.add(tr)
    }
  }

  const flush = () => {
    if (stopped || typeof document === 'undefined') return
    if (pendingRows.size === 0) return
    const rows = Array.from(pendingRows)
    pendingRows.clear()
    for (const tr of rows) {
      if (!tr.isConnected) {
        // The row left the ledger (virtualization, tab switch): drop every
        // reference so the tracking sets cannot grow without bound.
        unresolvedRows.delete(tr)
        labeledRows.delete(tr)
        continue
      }
      decorateRow(tr)
    }
  }

  const scheduleFrame = () => {
    if (rafId !== undefined || pendingRows.size === 0) return
    rafId = requestAnimationFrame(() => {
      rafId = undefined
      flush()
    })
  }

  /** Queue rows already on screen (initial paint and anchor-table changes). */
  const registerVisibleRows = () => {
    const rows = document.querySelectorAll('tr[data-trajectory-row-key]')
    for (const row of Array.from(rows)) pendingRows.add(row as HTMLElement)
    scheduleFrame()
  }

  const tick = async () => {
    if (stopped) return
    sessionId = currentSessionId()
    // Even without a session id in the URL we still poll: the host route then
    // answers with a merged anchor table of the most recent sessions (anchor
    // keys are globally unique, so only rows of the on-screen session match).
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      try {
        const query = sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''
        const response = await fetch('/effort-router/state' + query, {
          cache: 'no-store',
        })
        if (response.ok) {
          const json = await response.json()
          if (!stopped && json && json.ok === true) {
            const next: AnchorsState = {
              enabled: json.trajectoryAnnotate === true,
              anchors: json.anchors && typeof json.anchors === 'object' ? json.anchors : {},
            }
            const nextFingerprint = String(next.enabled) + ':' + Object.keys(next.anchors).length
            const changed = nextFingerprint !== fingerprint
            fingerprint = nextFingerprint
            anchors = next
            polls += 1
            if (changed || polls % FULL_SWEEP_EVERY === 0) {
              // The table gained keys (or annotation toggled): rows that were
              // decorated with no anchor may now resolve, and every caption
              // must leave if annotation was switched off.
              registerVisibleRows()
            } else if (unresolvedRows.size > 0) {
              for (const tr of Array.from(unresolvedRows)) pendingRows.add(tr)
              scheduleFrame()
            }
          }
        }
      } catch {
        // The route is best-effort; a failed poll keeps the last known state.
      }
    }
    pollTimer = setTimeout(tick, POLL_MS)
  }

  const observer = new MutationObserver((mutations) => {
    if (stopped) return
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType !== 1) continue
        const el = node as HTMLElement
        if (typeof el.matches === 'function' && el.matches('tr[data-trajectory-row-key]')) {
          pendingRows.add(el)
        }
        if (typeof el.querySelectorAll === 'function') {
          const rows = el.querySelectorAll('tr[data-trajectory-row-key]')
          for (const row of Array.from(rows)) pendingRows.add(row as HTMLElement)
        }
      }
      // Rows leaving the ledger (virtualized scroll, tab switch) must drop
      // out of the tracking Sets — they are the only strong references.
      if (unresolvedRows.size > 0 || labeledRows.size > 0 || pendingRows.size > 0) {
        for (const node of Array.from(mutation.removedNodes)) {
          if (node.nodeType !== 1) continue
          const el = node as HTMLElement
          if (typeof el.matches === 'function' && el.matches('tr[data-trajectory-row-key]')) {
            pendingRows.delete(el)
            unresolvedRows.delete(el)
            labeledRows.delete(el)
          }
          if (typeof el.querySelectorAll === 'function') {
            const rows = el.querySelectorAll('tr[data-trajectory-row-key]')
            for (const row of Array.from(rows)) {
              pendingRows.delete(row as HTMLElement)
              unresolvedRows.delete(row as HTMLElement)
              labeledRows.delete(row as HTMLElement)
            }
          }
        }
      }
    }
    scheduleFrame()
  })
  if (typeof document !== 'undefined' && document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }
  tick()

  return () => {
    stopped = true
    observer.disconnect()
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    if (rafId !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
  }
}
