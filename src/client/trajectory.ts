/**
 * dsh-effort-router — native trajectory hoisting (DOM projection).
 *
 * The trajectory ledger keys every row (data-trajectory-row-key) with anchors
 * we resolve against the host's effort-anchor table
 * (GET /effort-router/state?view=anchors&sessionId=… → anchors):
 *
 *   - tool rows:      encodeURIComponent('tool\0call\0<callId>')
 *   - message rows:   encodeURIComponent(<assistant message id>)
 *
 * Assistant anchor keys are per-session coordinates
 * (`assistant\0<turn>\0<step>`): the same key names an unrelated step in a
 * neighbouring session, so a caption is painted only from the table of the
 * row's OWN conversation root. When that root carries no valid
 * data-conversation-session (or has no such ancestor at all), the row is
 * omitted rather than guessed from an unrelated session or a URL fallback —
 * a missing caption is honest, another session's capsule is not.
 *
 * Placement: the caption rides the row's NATIVE request-boundary dot (the
 * first cell's button[data-request-run-index], the "请求 #N" control) as a
 * 9px chip straddling the row boundary, showing
 * `#N · provider/model · effort` with no hover needed. Clicking the chip
 * forwards to the dot, so the native request summary still opens; the chip
 * is a Tab stop and activates with Enter (on keydown) and Space (once, on
 * keyup) exactly like a button. Rows whose step renders no dot fall back to
 * an inline chip at the start of the row's text. Tool rows and rows without
 * an anchor stay untouched; decoration is keyed and idempotent, and outside
 * the trajectory tab (or when the host reports trajectoryAnnotate: false) it
 * is a no-op.
 *
 * Per-root isolation (T07): every conversation root on screen owns its own
 * session id, anchor table, poll timer, AbortController, observers and caption
 * caches. A body-level roster observer discovers roots and routes their
 * mutations; each row is claimed by its NEAREST root, so two side-by-side
 * ledgers each paint their own effort. A session switch or removal disposes
 * only that root: it never aborts a sibling root's in-flight read, never
 * clears a sibling's captions, and a late response from an old session is
 * dropped by that root's own poll generation.
 *
 * Performance (from 0.2.6): decoration is incremental on the next animation
 * frame; per-row anchor ids and caption elements live in WeakMaps; a full
 * re-registration happens only when the anchor-table fingerprint changes,
 * plus a slow sweep as a safety net.
 */

import { anchorOfRowKey, isSessionId } from './ids.js'
import { createPollGuard } from './poll-guard.js'

const POLL_MS = 2500
/** Every Nth successful poll forces a full re-registration (safety net). */
const FULL_SWEEP_EVERY = 8
const CAPTION_ATTR = 'data-er-trj'
const DONE_ATTR = 'data-er-trj-done'
/** The conversation root wraps the 对话/轨迹 tabs and owns one session. */
const ROOT_ATTR = 'data-conversation-session'
const ROOT_SELECTOR = '[' + ROOT_ATTR + ']'
const ROW_KEY_ATTR = 'data-trajectory-row-key'
const ROW_SELECTOR = 'tr[' + ROW_KEY_ATTR + ']'
/** Boundary-chip skin — settled on "transparent" after the rc.3/rc.4 A/B
 * round (maintainer's pick). The rejected skins (under / solid / gradient)
 * remain commented in src/client/styles.ts; the localStorage hook stays so
 * a future revisit can re-enable a skin without touching the decoration code.
 * Read ONCE at decorator start: it used to be re-read per decorated row,
 * i.e. several localStorage hits per repaint for a value that only needs a
 * reload to change. */
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

type AnchorRecord = AnchorsState['anchors'][string]

interface PollToken {
  generation: number
  sessionId: string | null
  hint: string | null
}

interface RootState {
  root: HTMLElement
  sessionId: string
  guard: ReturnType<typeof createPollGuard>
  anchors: AnchorsState
  fingerprint: string
  polls: number
  timer: ReturnType<typeof setTimeout> | undefined
  controller: AbortController | null
  polling: boolean
  loadId: number
  stopped: boolean
  observer: MutationObserver | null
  /** Rows queued for decoration on the next animation frame. */
  pendingRows: Set<HTMLElement>
  /** Per-row caches: DOM key → anchor id, row → caption element. */
  anchorIds: WeakMap<HTMLElement, string | null>
  captions: WeakMap<HTMLElement, HTMLElement>
  rafId: number | undefined
}

/** The conversation root a ledger row belongs to (nearest ancestor). */
function nearestRoot(el: HTMLElement): HTMLElement | null {
  return typeof el.closest === 'function' ? (el.closest(ROOT_SELECTOR) as HTMLElement | null) : null
}

/** The root's own session id, or null when it is absent/invalid. */
function sessionOf(root: HTMLElement): string | null {
  const id = root.getAttribute(ROOT_ATTR)
  return isSessionId(id) ? id : null
}

function isRootElement(el: HTMLElement): boolean {
  return typeof el.matches === 'function' && el.matches(ROOT_SELECTOR)
}

function isRowElement(el: HTMLElement): boolean {
  return typeof el.matches === 'function' && el.matches(ROW_SELECTOR)
}

/** Rows owned by this root (a nested root keeps its own rows). */
function rowsOf(root: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  if (typeof root.querySelectorAll !== 'function') return rows
  for (const node of Array.from(root.querySelectorAll(ROW_SELECTOR))) {
    const tr = node as HTMLElement
    if (nearestRoot(tr) === root) rows.push(tr)
  }
  return rows
}

/**
 * Inline fallback mount: INSIDE the content cell's text container — the
 * cell's first element child (the host's text block; its class names are
 * hashed, so mount structurally rather than through a class selector).
 * Inserting BEFORE that block would put the caption on its own line above the
 * row text; inserting INTO it keeps the caption on the same line, visually
 * right of the 【助手】 badge.
 */
function mountInline(tr: HTMLElement, caption: HTMLElement) {
  const cell = tr.querySelector('td:last-child')
  const target = (cell && cell.firstElementChild) ?? cell ?? tr
  target.insertAdjacentElement('afterbegin', caption)
}

/** The row's native request-boundary dot ("请求 #N"), if this row starts
 * its request group. Lives in the left event cell (the first td). */
function requestDotOf(tr: HTMLElement): HTMLElement | null {
  const cell = tr.querySelector('td:first-child')
  const dot = cell ? cell.querySelector('button[data-request-run-index]') : null
  return dot === null ? null : (dot as HTMLElement)
}

/** Request number out of the dot's label ("请求 #42" / "Request #42"). */
function requestNumberOf(dot: HTMLElement): string {
  const label = dot.getAttribute('data-label') || dot.getAttribute('aria-label') || ''
  const match = /#(\d+)/.exec(label)
  return match ? match[1] : ''
}

// Boundary mount: a tiny chip absolutely positioned inside the event cell
// (overflow:visible) right of the dot, straddling the row boundary. The dot's
// own stacking offset is mirrored so stacked dots shift the chip too.
// Clicking the chip forwards to the dot — the native request summary opens
// without a second control to learn.
function mountBoundary(tr: HTMLElement, caption: HTMLElement, dot: HTMLElement) {
  const offset = dot.style.getPropertyValue('--request-boundary-offset') || '0px'
  const left = 'calc(30px + ' + offset + ')'
  if (caption.style.left !== left) caption.style.left = left
  const cell = tr.querySelector('td:first-child')
  if (cell && caption.parentElement !== cell) cell.appendChild(caption)
}

function labelOf(anchor: AnchorRecord): string {
  const provider = anchor.provider ? String(anchor.provider) : ''
  const model = anchor.model ? String(anchor.model) : ''
  const route = provider && model ? provider + '/' + model : model || provider
  const effort = anchor.effort === null || anchor.effort === undefined || anchor.effort === ''
    ? 'default'
    : String(anchor.effort)
  return route ? route + ' · ' + effort : ''
}

/**
 * Cheap content hash of the anchor table. Count alone cannot tell two
 * same-sized tables apart — e.g. two roots switching sessions — and a stale
 * table would keep painting the wrong session's capsules.
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
  if (typeof document === 'undefined') return () => {}
  let stopped = false
  /** One independent poller/cache per conversation root on screen. */
  const states = new Map<HTMLElement, RootState>()
  /** Body-level roster observer: discovers roots and routes root mutations. */
  let roster: MutationObserver | null = null
  /** Boundary-chip skin, resolved once per decorator lifetime. */
  const variant = chipVariant()

  const hasTrajectoryRows = (st: RootState): boolean => rowsOf(st.root).length > 0

  const shedRow = (st: RootState, tr: HTMLElement) => {
    const caption = st.captions.get(tr)
    if (caption) {
      caption.remove()
      st.captions.delete(tr)
    }
    tr.removeAttribute(DONE_ATTR)
    st.pendingRows.delete(tr)
  }

  const decorateRow = (st: RootState, tr: HTMLElement) => {
    if (stopped || st.stopped) return
    // React may strip our foreign caption when it re-renders the cell that
    // hosts it; a cached-but-disconnected caption must force a full
    // re-create, or the DONE marker below would suppress the re-mount.
    const existing = st.captions.get(tr)
    if (existing && !existing.isConnected) {
      // Still-remembered but detached (React replaced the cell content, or
      // the row sat in a detached subtree): drop the orphan so a fresh chip
      // cannot end up next to it.
      if (typeof existing.remove === 'function') existing.remove()
      st.captions.delete(tr)
      tr.removeAttribute(DONE_ATTR)
    }
    // Only assistant message rows carry the caption: tool rows are already
    // attributed to the step that produced them, and the chip belongs to the
    // request that produced the assistant step.
    const isAssistantRow = (tr.getAttribute('data-kind') || '') === 'message'
    let anchorId: string | null = null
    if (isAssistantRow) {
      if (st.anchorIds.has(tr)) {
        anchorId = st.anchorIds.get(tr) ?? null
      } else {
        anchorId = anchorOfRowKey(tr.getAttribute(ROW_KEY_ATTR) || '')
        st.anchorIds.set(tr, anchorId)
      }
    }
    const anchor = anchorId !== null && st.anchors.enabled ? st.anchors.anchors[anchorId] : undefined
    const label = anchor ? labelOf(anchor) : ''
    const dot = label && isAssistantRow ? requestDotOf(tr) : null
    const placement = label ? (dot !== null ? 'b' : 'i') : ''
    const requestNo = dot !== null ? requestNumberOf(dot) : ''
    const text = placement === 'b' && requestNo !== '' ? '#' + requestNo + ' · ' + label : label
    const skin = placement === 'b' ? variant : ''
    const doneValue = placement + '|' + requestNo + '|' + label + '|' + skin
    if (tr.getAttribute(DONE_ATTR) === doneValue) return
    tr.setAttribute(DONE_ATTR, doneValue)
    let caption = st.captions.get(tr)
    if (!placement) {
      if (caption) {
        caption.remove()
        st.captions.delete(tr)
      }
      return
    }
    if (caption && caption.getAttribute('data-er-trj-place') !== placement) {
      caption.remove()
      st.captions.delete(tr)
      caption = undefined
    }
    if (!caption) {
      caption = document.createElement('span')
      caption.setAttribute(CAPTION_ATTR, '')
      caption.setAttribute('data-er-trj-place', placement)
      st.captions.set(tr, caption)
      if (placement === 'b') {
        caption.setAttribute('class', 'er-trj-boundary')
        caption.setAttribute('data-er-trj-v', skin)
        // The chip is a control (it opens the native request summary), so it
        // must be reachable by Tab and operable by Enter/Space exactly like a
        // button; the visible focus ring comes from CSS.
        caption.setAttribute('role', 'button')
        caption.setAttribute('tabindex', '0')
        if ('tabIndex' in caption) caption.tabIndex = 0
        const activate = () => {
          const target = requestDotOf(tr)
          if (target) target.click()
        }
        caption.addEventListener('click', (event) => {
          event.stopPropagation()
          activate()
        })
        caption.addEventListener('keydown', (event) => {
          const key = event && event.key
          if (key === 'Enter') {
            // Native button: Enter activates on keydown, auto-repeat is inert.
            event.stopPropagation()
            if (event.repeat) return
            event.preventDefault()
            activate()
            return
          }
          if (key === ' ' || key === 'Spacebar') {
            // Native button: Space would scroll unless cancelled here; the
            // activation happens once on keyup, never on keydown/repeat.
            event.preventDefault()
            event.stopPropagation()
          }
        })
        caption.addEventListener('keyup', (event) => {
          const key = event && event.key
          if (key !== ' ' && key !== 'Spacebar') return
          event.stopPropagation()
          if (event.repeat) return
          activate()
        })
      } else {
        caption.setAttribute('class', 'er-trj')
      }
    }
    if (placement === 'b' && dot !== null) mountBoundary(tr, caption, dot)
    else if (placement === 'i' && !caption.isConnected) mountInline(tr, caption)
    if (placement === 'b' && caption.getAttribute('data-er-trj-v') !== skin) {
      caption.setAttribute('data-er-trj-v', skin)
    }
    caption.setAttribute('title', text)
    if (caption.textContent !== text) caption.textContent = text
  }

  const flush = (st: RootState) => {
    if (stopped || st.stopped || st.pendingRows.size === 0) return
    const rows = Array.from(st.pendingRows)
    st.pendingRows.clear()
    for (const tr of rows) {
      if (!tr.isConnected || nearestRoot(tr) !== st.root) {
        // The row left this root (virtualization, tab switch, another root):
        // unpaint it and drop every strong reference instead of decorating a
        // stale node. Re-entry goes through the root observer again.
        shedRow(st, tr)
        st.anchorIds.delete(tr)
        continue
      }
      decorateRow(st, tr)
    }
  }

  const scheduleFrame = (st: RootState) => {
    if (stopped || st.stopped || st.rafId !== undefined || st.pendingRows.size === 0) return
    if (typeof requestAnimationFrame !== 'function') {
      flush(st)
      return
    }
    st.rafId = requestAnimationFrame(() => {
      st.rafId = undefined
      flush(st)
    })
  }

  /** Queue rows already under this root (initial paint, table changes). */
  const registerRows = (st: RootState) => {
    if (stopped || st.stopped) return
    for (const tr of rowsOf(st.root)) st.pendingRows.add(tr)
    scheduleFrame(st)
  }

  /** Drop this root's painted captions and blank its table cache. */
  const clearCaptions = (st: RootState) => {
    for (const tr of rowsOf(st.root)) shedRow(st, tr)
    st.pendingRows.clear()
    st.anchors = { enabled: false, anchors: {} }
    st.fingerprint = ''
  }

  const stopPoll = (st: RootState) => {
    st.loadId += 1
    if (st.controller) {
      st.controller.abort()
      st.controller = null
    }
    st.polling = false
    if (st.timer !== undefined) {
      clearTimeout(st.timer)
      st.timer = undefined
    }
  }

  const isCurrent = (st: RootState, loadId: number, token: PollToken): boolean =>
    !stopped && !st.stopped && st.loadId === loadId && st.guard.isCurrent(token)

  const schedulePoll = (st: RootState) => {
    if (stopped || st.stopped) return
    if (st.polling || st.timer !== undefined) return
    if (!hasTrajectoryRows(st)) return
    st.timer = setTimeout(() => {
      st.timer = undefined
      void poll(st)
    }, POLL_MS)
  }

  const poll = async (st: RootState) => {
    if (stopped || st.stopped) return
    if (!hasTrajectoryRows(st)) return
    st.loadId += 1
    const loadId = st.loadId
    const token = st.guard.snapshot()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    st.controller = controller
    st.polling = true
    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const params = new URLSearchParams()
      params.set('view', 'anchors')
      // Ownership is mandatory: a root without a valid session id never got
      // a RootState, so this request is always scoped to a known session.
      if (token.sessionId) params.set('sessionId', token.sessionId)
      const response = await fetch('/effort-router/state?' + params.toString(), {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (!response.ok) return
      const json = await response.json()
      if (!isCurrent(st, loadId, token)) return
      if (!json || json.ok !== true) return
      const next: AnchorsState = {
        enabled: json.trajectoryAnnotate === true,
        anchors: json.anchors && typeof json.anchors === 'object' ? json.anchors : {},
      }
      const nextFingerprint = String(next.enabled) + ':' + String(hashAnchors(next.anchors))
      const changed = nextFingerprint !== st.fingerprint
      st.fingerprint = nextFingerprint
      st.anchors = next
      st.polls += 1
      if (changed || st.polls % FULL_SWEEP_EVERY === 0) {
        // The table gained keys (or annotation toggled): rows that were
        // decorated with no anchor may now resolve, and every caption must
        // leave if annotation was switched off.
        registerRows(st)
      }
    } catch {
      // The route is best-effort; a failed poll keeps the last known state.
    } finally {
      if (st.controller === controller) {
        st.controller = null
        st.polling = false
      }
      schedulePoll(st)
    }
  }

  /** Start an immediate poll for one root (initial paint / new rows). */
  const wakeRoot = (st: RootState) => {
    if (stopped || st.stopped || st.polling) return
    if (!hasTrajectoryRows(st)) return
    if (st.timer !== undefined) {
      clearTimeout(st.timer)
      st.timer = undefined
    }
    void poll(st)
  }

  /** Re-read one root's session; only that root is cleared and restarted. */
  const switchSession = (st: RootState, id: string) => {
    if (stopped || st.stopped) return
    st.sessionId = id
    st.guard.updateSession(id)
    stopPoll(st)
    clearCaptions(st)
    registerRows(st)
    wakeRoot(st)
  }

  const disposeRoot = (st: RootState) => {
    if (st.stopped) return
    st.stopped = true
    stopPoll(st)
    if (st.rafId !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.rafId)
    st.rafId = undefined
    if (st.observer) {
      st.observer.disconnect()
      st.observer = null
    }
    for (const tr of rowsOf(st.root)) shedRow(st, tr)
    st.pendingRows.clear()
    states.delete(st.root)
  }

  const pruneRow = (st: RootState, tr: HTMLElement) => {
    st.pendingRows.delete(tr)
    st.anchorIds.delete(tr)
    st.captions.delete(tr)
  }

  const pruneTree = (st: RootState, el: HTMLElement) => {
    if (isRowElement(el)) pruneRow(st, el)
    if (el.firstElementChild && typeof el.querySelectorAll === 'function') {
      for (const row of Array.from(el.querySelectorAll(ROW_SELECTOR))) pruneRow(st, row as HTMLElement)
    }
  }

  const handleRootMutations = (st: RootState, mutations: MutationRecord[]) => {
    if (stopped || st.stopped) return
    let rowsAdded = false
    for (const mutation of mutations) {
      // React reuses a row element when the incoming record carries the same
      // row key: the key attribute is then the ONLY signal that the row now
      // shows a different record — drop every cache and re-decorate.
      if (mutation.type === 'attributes') {
        if (mutation.attributeName !== ROW_KEY_ATTR) continue
        const el = mutation.target as HTMLElement
        st.anchorIds.delete(el)
        const caption = st.captions.get(el)
        if (caption) {
          caption.remove()
          st.captions.delete(el)
        }
        el.removeAttribute(DONE_ATTR)
        st.pendingRows.add(el)
        continue
      }
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (!node || node.nodeType !== 1) continue
        const el = node as HTMLElement
        if (isRowElement(el)) {
          st.pendingRows.add(el)
          rowsAdded = true
        } else if (el.firstElementChild && typeof el.querySelectorAll === 'function') {
          // Skip leaf nodes: streaming text and composer updates are the
          // common case and cannot contain a ledger row.
          for (const row of Array.from(el.querySelectorAll(ROW_SELECTOR))) {
            st.pendingRows.add(row as HTMLElement)
            rowsAdded = true
          }
        }
      }
      // Rows leaving the ledger must drop out of the strong-reference set.
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (!node || node.nodeType !== 1) continue
        pruneTree(st, node as HTMLElement)
      }
    }
    if (rowsAdded) wakeRoot(st)
    scheduleFrame(st)
  }

  const containsRoot = (el: HTMLElement): boolean => {
    if (isRootElement(el)) return true
    return !!el.firstElementChild
      && typeof el.querySelectorAll === 'function'
      && el.querySelectorAll(ROOT_SELECTOR).length > 0
  }

  const reconcileRoots = () => {
    if (stopped) return
    if (typeof document.querySelectorAll !== 'function') return
    const roots = Array.from(document.querySelectorAll(ROOT_SELECTOR))
    const live = new Set<HTMLElement>()
    for (const node of roots) {
      const root = node as HTMLElement
      const id = sessionOf(root)
      // Unknown ownership stays unlabelled — and unrequested.
      if (!id) continue
      live.add(root)
      const st = states.get(root)
      if (!st) ensureRoot(root, id)
      else if (st.sessionId !== id) switchSession(st, id)
    }
    for (const st of Array.from(states.values())) {
      if (!live.has(st.root) || !st.root.isConnected) disposeRoot(st)
    }
  }

  const handleRosterMutations = (mutations: MutationRecord[]) => {
    if (stopped) return
    let inspect = false
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        // A root's own session attribute changed (or was removed).
        if (mutation.attributeName === ROOT_ATTR) inspect = true
        continue
      }
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (node && node.nodeType === 1 && containsRoot(node as HTMLElement)) inspect = true
      }
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (node && node.nodeType === 1 && containsRoot(node as HTMLElement)) inspect = true
      }
    }
    if (inspect) reconcileRoots()
  }

  const ensureRoot = (root: HTMLElement, id: string) => {
    if (stopped || states.has(root)) return
    const st: RootState = {
      root,
      sessionId: id,
      guard: createPollGuard(),
      anchors: { enabled: false, anchors: {} },
      fingerprint: '',
      polls: 0,
      timer: undefined,
      controller: null,
      polling: false,
      loadId: 0,
      stopped: false,
      observer: null,
      pendingRows: new Set<HTMLElement>(),
      anchorIds: new WeakMap<HTMLElement, string | null>(),
      captions: new WeakMap<HTMLElement, HTMLElement>(),
      rafId: undefined,
    }
    st.guard.updateSession(id)
    states.set(root, st)
    if (typeof MutationObserver === 'function') {
      st.observer = new MutationObserver((mutations) => handleRootMutations(st, mutations))
      st.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [ROW_KEY_ATTR],
      })
    }
    registerRows(st)
    wakeRoot(st)
  }

  if (typeof MutationObserver === 'function' && document.body) {
    roster = new MutationObserver(handleRosterMutations)
    roster.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [ROOT_ATTR],
    })
  }
  reconcileRoots()

  return () => {
    if (stopped) return
    stopped = true
    if (roster) {
      roster.disconnect()
      roster = null
    }
    for (const st of Array.from(states.values())) disposeRoot(st)
    states.clear()
  }
}
