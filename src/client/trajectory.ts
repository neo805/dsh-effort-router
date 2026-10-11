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
      // Only assistant message rows carry the caption: tool rows are already
      // attributed to the step that produced them, and the badge belongs
      // next to the purple 【助手】 chip.
      const isAssistantRow = (tr.getAttribute('data-kind') || '') === 'message'
      const rowKey = tr.getAttribute('data-trajectory-row-key') || ''
      const anchorId = anchorOf(rowKey)
      const anchor = isAssistantRow && anchorId !== null && anchors.enabled ? anchors.anchors[anchorId] : undefined
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
