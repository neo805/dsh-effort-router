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
 * gain a compact caption. Placement (0.2.7-rc.2 redesign): the caption rides
 * the row's NATIVE request-boundary dot (td.event >
 * button[data-request-run-index] — the "请求 #N" control that opens the
 * request summary) as a tiny 9px chip straddling the row boundary right of
 * the dot, showing `#N · provider/model · effort` with no hover or click
 * needed; clicking the chip forwards to the dot so the native request
 * summary still opens. The dot's per-row stacking offset
 * (--request-boundary-offset) is mirrored onto the chip. Rows whose step
 * renders no dot (collapsed sections, request-only shells) fall back to the
 * previous inline caption at the start of the row's text. Tool rows and rows
 * that resolve to nothing stay untouched. Everything is idempotent (rows are
 * keyed, captions carry a marker) and degrades to a no-op outside the
 * trajectory tab or when the host route reports trajectoryAnnotate: false.
 * When the shell URL carries no session id the host route answers with a
 * merged anchor table of the most recent sessions; one visible tool call id
 * travels as `hint` so the host can answer with the on-screen session's OWN
 * table — assistant anchor keys are per-session coordinates and collide
 * across sessions, so a bare merged table can otherwise paint a neighbouring
 * session's capsules (fixed in 0.2.7).
 *
 * Session-switch staleness: row keys collide across sessions, and React
 * REUSES a row element when the next session renders a row with the same
 * key, so for up to one poll interval the reused rows could show the
 * previous session's captions. The observer re-reads the route on every
 * mutation batch; a session change clears every caption and blanks the
 * cached table synchronously, so rows go bare (never wrong) until the next
 * poll paints the current session's chips.
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
/** Boundary-chip skin — settled on "transparent" after the rc.3/rc.4 A/B
 * round (maintainer's pick). The rejected skins (under / solid / gradient)
 * remain commented in src/client/styles.ts; the localStorage hook stays so
 * a future revisit can re-enable a skin without touching this file. */
const CHIP_VARIANTS = new Set(['transparent'])
const CHIP_VARIANT_DEFAULT = 'transparent'

/** Active boundary-chip skin: localStorage "er.trj.variant", else default. */
function chipVariant(): string {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem('er.trj.variant')
    if (v !== null && CHIP_VARIANTS.has(v)) return v
  } catch {
    // localStorage can throw in hardened contexts; the default skin is fine.
  }
  return CHIP_VARIANT_DEFAULT
}

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

/**
 * One tool call id visible on screen. Call ids are globally unique, so the
 * host resolves the on-screen session's own anchor table from it — assistant
 * anchor keys (per-session turn/step coordinates) collide across sessions in
 * the merged fallback and cannot identify the session on their own.
 */
function visibleToolCallId(): string | null {
  if (typeof document === 'undefined') return null
  const rows = document.querySelectorAll('tr[data-trajectory-row-key]')
  const toolPrefix = 'tool\0call\0'
  for (const row of Array.from(rows)) {
    const raw = (row as HTMLElement).getAttribute('data-trajectory-row-key') || ''
    let key: string
    try {
      key = decodeURIComponent(raw)
    } catch {
      continue
    }
    if (key.startsWith(toolPrefix)) return key.slice(toolPrefix.length)
  }
  return null
}

/**
 * Cheap content hash of the anchor table. Count alone cannot tell two
 * same-sized tables apart — e.g. the hint switching the resolved session —
 * and a stale table would keep painting the previous session's capsules.
 */
function hashAnchors(table: AnchorsState['anchors']): number {
  let h = 5381
  for (const key of Object.keys(table).sort()) {
    const a = table[key]
    const s = key + '|' + (a && a.provider) + '|' + (a && a.model) + '|' + (a && a.effort)
    for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return h
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

  // Inline fallback mount: INSIDE the content cell's text container
  // (td.content > span.contentText — display:block holding inline spans).
  // Inserting before that block container puts the caption on its own line
  // ABOVE the row text; inserting INTO it keeps the caption on the same
  // line, visually right of the 【助手】 badge, pushing the row's own text
  // right.
  const mountInline = (tr: HTMLElement, caption: HTMLElement) => {
    const cell = tr.querySelector('td:last-child')
    const target = (cell && cell.firstElementChild) ?? cell ?? tr
    target.insertAdjacentElement('afterbegin', caption)
  }

  /** The row's native request-boundary dot ("请求 #N"), if this row starts
   * its request group. Lives in the left event cell (the first td). */
  const requestDotOf = (tr: HTMLElement): HTMLElement | null => {
    const cell = tr.querySelector('td:first-child')
    const dot = cell ? cell.querySelector('button[data-request-run-index]') : null
    return dot === null ? null : (dot as HTMLElement)
  }

  /** Request number out of the dot's label ("请求 #42" / "Request #42"). */
  const requestNumberOf = (dot: HTMLElement): string => {
    const label = dot.getAttribute('data-label') || dot.getAttribute('aria-label') || ''
    const match = /#(\d+)/.exec(label)
    return match ? match[1] : ''
  }

  // Boundary mount: a tiny chip absolutely positioned inside the event cell
  // (overflow:visible) right of the dot, straddling the row boundary. The
  // dot's own stacking offset is mirrored so stacked dots shift the chip
  // too. Clicking the chip forwards to the dot — the native request summary
  // opens without a second control to learn.
  const mountBoundary = (tr: HTMLElement, caption: HTMLElement, dot: HTMLElement) => {
    const offset = dot.style.getPropertyValue('--request-boundary-offset') || '0px'
    const left = 'calc(30px + ' + offset + ')'
    if (caption.style.left !== left) caption.style.left = left
    const cell = tr.querySelector('td:first-child')
    if (cell && caption.parentElement !== cell) cell.appendChild(caption)
  }

  const decorateRow = (tr: HTMLElement) => {
    // React may strip our foreign caption when it re-renders the cell that
    // hosts it; a cached-but-disconnected caption must force a full
    // re-create, or the DONE marker below would suppress the re-mount.
    const existing = captions.get(tr)
    if (existing && !existing.isConnected) {
      captions.delete(tr)
      tr.removeAttribute(DONE_ATTR)
    }
    // Only assistant message rows carry the caption: tool rows are already
    // attributed to the step that produced them, and the chip belongs to the
    // request that produced the assistant step.
    const isAssistantRow = (tr.getAttribute('data-kind') || '') === 'message'
    const anchorId = isAssistantRow ? anchorIdOf(tr) : null
    const anchor = anchorId !== null && anchors.enabled ? anchors.anchors[anchorId] : undefined
    const label = anchor ? labelOf(anchor) : ''
    const dot = label && isAssistantRow ? requestDotOf(tr) : null
    const placement = label ? (dot !== null ? 'b' : 'i') : ''
    const requestNo = dot !== null ? requestNumberOf(dot) : ''
    const text = placement === 'b' && requestNo !== '' ? '#' + requestNo + ' · ' + label : label
    const variant = placement === 'b' ? chipVariant() : ''
    const doneValue = placement + '|' + requestNo + '|' + label + '|' + variant
    if (tr.getAttribute(DONE_ATTR) !== doneValue) {
      tr.setAttribute(DONE_ATTR, doneValue)
      let caption = captions.get(tr)
      if (!placement) {
        if (caption) {
          caption.remove()
          captions.delete(tr)
        }
      } else {
        if (caption && caption.getAttribute('data-er-trj-place') !== placement) {
          caption.remove()
          captions.delete(tr)
          caption = undefined
        }
        if (!caption) {
          caption = document.createElement('span')
          caption.setAttribute(CAPTION_ATTR, '')
          caption.setAttribute('data-er-trj-place', placement)
          captions.set(tr, caption)
          if (placement === 'b') {
            caption.setAttribute('class', 'er-trj-boundary')
            caption.setAttribute('data-er-trj-v', variant)
            caption.addEventListener('click', (event) => {
              event.stopPropagation()
              const target = requestDotOf(tr)
              if (target) target.click()
            })
          } else {
            caption.setAttribute('class', 'er-trj')
          }
        }
        if (placement === 'b' && dot !== null) mountBoundary(tr, caption, dot)
        else if (placement === 'i' && !caption.isConnected) mountInline(tr, caption)
        if (placement === 'b' && caption.getAttribute('data-er-trj-v') !== variant) {
          caption.setAttribute('data-er-trj-v', variant)
        }
        caption.setAttribute('title', text)
        if (caption.textContent !== text) caption.textContent = text
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

  /** Drop every painted caption and blank the table cache — used when the
   * route's session changes so reused rows go bare instead of showing the
   * previous session's chips until the next poll arrives. */
  const clearAllCaptions = () => {
    for (const tr of Array.from(labeledRows)) {
      const caption = captions.get(tr)
      if (caption) {
        caption.remove()
        captions.delete(tr)
      }
      tr.removeAttribute(DONE_ATTR)
      pendingRows.add(tr)
    }
    labeledRows.clear()
    anchors = { enabled: false, anchors: {} }
    fingerprint = ''
  }

  /** Sync the tracked session id from the route; clears captions on change. */
  const syncSessionFromRoute = () => {
    const current = currentSessionId()
    if (current !== sessionId) {
      sessionId = current
      clearAllCaptions()
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
    syncSessionFromRoute()
    // Even without a session id in the URL we still poll: the host route then
    // answers with a merged anchor table of the most recent sessions. One
    // visible tool call id goes along as `hint` — assistant anchor keys
    // collide across sessions, and the hint lets the host answer with the
    // on-screen session's own table instead.
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      try {
        const params = new URLSearchParams()
        if (sessionId) params.set('sessionId', sessionId)
        else {
          const hint = visibleToolCallId()
          if (hint) params.set('hint', hint)
        }
        const query = params.toString() ? '?' + params.toString() : ''
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
            const nextFingerprint = String(next.enabled) + ':' + String(hashAnchors(next.anchors))
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
    // A session switch replaces the ledger en masse; re-read the route now
    // (not at the next poll) so reused rows shed the old session's captions
    // within one mutation batch instead of up to one poll interval.
    syncSessionFromRoute()
    for (const mutation of mutations) {
      // React reuses a row element when the incoming record carries the same
      // row key: the key attribute is then the ONLY signal that the row now
      // shows a different record — drop every cache and re-decorate.
      if (mutation.type === 'attributes') {
        const el = mutation.target as HTMLElement
        if (typeof el.matches === 'function' && el.matches('tr[data-trajectory-row-key]')) {
          anchorIds.delete(el)
          const caption = captions.get(el)
          if (caption) {
            caption.remove()
            captions.delete(el)
          }
          el.removeAttribute(DONE_ATTR)
          pendingRows.add(el)
        }
        continue
      }
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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-trajectory-row-key'],
    })
  }
  tick()

  return () => {
    stopped = true
    observer.disconnect()
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    if (rafId !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
  }
}
