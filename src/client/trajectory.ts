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
 * Rows that resolve to an anchor gain a compact caption
 * `provider/model · effort` right after the row's kind chip (the purple 助手
 * badge); rows that resolve to nothing stay untouched. Everything is
 * idempotent (rows are keyed, captions carry a marker) and degrades to a
 * no-op outside the trajectory tab or when the host route reports
 * trajectoryAnnotate: false. When the shell URL carries no session id the
 * host route answers with a merged anchor table of the most recent sessions
 * (anchor keys are globally unique, so only the on-screen session's rows
 * resolve).
 */

const POLL_MS = 2500
const DECORATE_DEBOUNCE_MS = 250
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
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let decorateTimer: ReturnType<typeof setTimeout> | undefined
  let sessionId: string | null = null

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
            anchors = {
              enabled: json.trajectoryAnnotate === true,
              anchors: json.anchors && typeof json.anchors === 'object' ? json.anchors : {},
            }
            scheduleDecorate()
          }
        }
      } catch {
        // The route is best-effort; a failed poll keeps the last known state.
      }
    }
    pollTimer = setTimeout(tick, POLL_MS)
  }

  const labelOf = (anchor: { provider: string | null; model: string | null; effort: string | null }) => {
    const provider = anchor.provider ? String(anchor.provider) : ''
    const model = anchor.model ? String(anchor.model) : ''
    const route = provider && model ? provider + '/' + model : model || provider
    const effort = anchor.effort === null || anchor.effort === undefined || anchor.effort === ''
      ? 'default'
      : String(anchor.effort)
    return route ? route + ' · ' + effort : ''
  }

  const decorate = () => {
    if (stopped || typeof document === 'undefined') return
    const rows = document.querySelectorAll('tr[data-trajectory-row-key]')
    for (const row of Array.from(rows)) {
      const tr = row as HTMLElement
      const rowKey = tr.getAttribute('data-trajectory-row-key') || ''
      const anchorId = anchorOf(rowKey)
      const anchor = anchorId !== null && anchors.enabled ? anchors.anchors[anchorId] : undefined
      const label = anchor ? labelOf(anchor) : ''
      if (tr.getAttribute(DONE_ATTR) === label) continue
      tr.setAttribute(DONE_ATTR, label)
      const existing = tr.querySelector('[' + CAPTION_ATTR + ']')
      if (!label) {
        if (existing) existing.remove()
        continue
      }
      const caption = existing ?? document.createElement('span')
      caption.setAttribute(CAPTION_ATTR, '')
      caption.setAttribute('class', 'er-trj')
      caption.setAttribute('title', label)
      caption.textContent = label
      if (!existing) mountCaption(tr, caption)
    }
  }

  // Preferred mount: inside the first cell's eventInner, right after the
  // kind chip (data-role-kind = the purple 助手 badge), so the caption reads
  // 【助手】 provider/model · effort. Fallback: the row's last cell.
  const mountCaption = (tr: HTMLElement, caption: HTMLElement) => {
    const chip = tr.querySelector('td [data-role-kind]')
    const slot = chip && chip.parentElement
    if (slot && slot.parentElement) {
      slot.insertAdjacentElement('afterend', caption)
      return
    }
    const cell = tr.querySelector('td:last-child') ?? tr
    cell.appendChild(caption)
  }

  const scheduleDecorate = () => {
    if (decorateTimer !== undefined) return
    decorateTimer = setTimeout(() => {
      decorateTimer = undefined
      decorate()
    }, DECORATE_DEBOUNCE_MS)
  }

  const observer = new MutationObserver(scheduleDecorate)
  if (typeof document !== 'undefined' && document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }
  tick()

  return () => {
    stopped = true
    observer.disconnect()
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    if (decorateTimer !== undefined) clearTimeout(decorateTimer)
  }
}
