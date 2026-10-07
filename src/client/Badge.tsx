/**
 * dsh-effort-router — composer badge (conversation.input.right).
 *
 * One compact pill next to the model selector: the mode and the effort the
 * LAST step of this session ran with, with the scheduler's class/score/reason
 * in the tooltip. Data comes from the read-only host route
 * GET /effort-router/state?sessionId=…, polled only while the tab is visible.
 * The native selector remains the control — this badge is deliberately
 * read-only so the composer never gains a second effort input.
 */
import { useEffect, useState } from 'react'

interface DecisionState {
  ok: boolean
  enabled: boolean
  last: {
    mode?: string
    effort?: string | null
    tier?: string | null
    stepClass?: string | null
    score?: number | null
    reason?: string
  } | null
}

const POLL_MS = 2500

export function Badge(props: { sessionId?: string; t: (key: string) => string }) {
  const { sessionId, t } = props
  const [state, setState] = useState<DecisionState | null>(null)

  useEffect(() => {
    if (!sessionId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stopped) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(tick, POLL_MS * 4)
        return
      }
      try {
        const response = await fetch('/effort-router/state?sessionId=' + encodeURIComponent(sessionId), {
          cache: 'no-store',
        })
        if (response.ok) {
          const json = (await response.json()) as DecisionState
          if (!stopped) setState(json)
        }
      } catch {
        // The route is best-effort; a failed poll keeps the last known state.
      }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [sessionId])

  if (!state || state.ok !== true || state.enabled !== true) return null

  const last = state.last
  const modeKey = last && typeof last.mode === 'string' ? last.mode : 'auto'
  const modeLabel =
    // 'manual-stripped' counts as a manual pick (the level was refused by the model)
    modeKey === 'manual' || modeKey === 'manual-stripped' ? t('badge.manual')
    : modeKey === 'default' ? t('badge.default')
    : modeKey === 'subagent' ? t('badge.subagent')
    : modeKey === 'poisoned' ? t('badge.poisoned')
    : modeKey === 'unsupported' ? t('badge.unsupported')
    : t('badge.auto')
  const effort = last && (last.effort ?? last.tier)
  const label = last ? modeLabel + (effort ? ' · ' + String(effort) : '') : modeLabel

  const tooltip = !last
    ? t('badge.none')
    : [
        last.stepClass ? `class: ${last.stepClass}` : '',
        last.score !== null && last.score !== undefined ? `score: ${last.score}` : '',
        last.reason || '',
      ].filter(Boolean).join('\n')

  return (
    <span className="er-badge" data-on="true" title={tooltip}>
      <span className="er-badge-dot" />
      {label}
    </span>
  )
}
