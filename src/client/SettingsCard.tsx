/**
 * dsh-effort-router — settings section card.
 *
 * One settings.section entry: global scheduler config (own entry, via
 * configForms) plus the llm-pi-ai custom-model effort editor (the shared
 * providers section, written whole so the host schema gates every save).
 * All controls are native elements on theme tokens — no UI kit.
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  fillCandidates,
  isCustomGateway,
  normalizeEffortTable,
  validateEffortTable,
  withDefaultEfforts,
  withModelEfforts,
} from '../../lib/custom-models.js'

/** Levels offered by the per-model editor (llm-pi-ai's standard vocabulary). */
const EDITABLE_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function useScope(scope: any) {
  return useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
}

function SwitchRow(props: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="er-row">
      <label htmlFor={undefined}>{props.label}</label>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </div>
  )
}

function SelectRow(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="er-row">
      <label>{props.label}</label>
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

function NumberRow(props: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="er-row">
      <label>{props.label}</label>
      <input
        type="number"
        value={String(props.value)}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        onChange={(event) => {
          const next = Number(event.currentTarget.value)
          if (Number.isFinite(next)) props.onChange(next)
        }}
      />
    </div>
  )
}

/** One model row of the custom-model editor: level checkboxes + wire values. */
function ModelEditor(props: {
  provider: string
  model: string
  table: Record<string, string | null> | false | undefined
  readonly: boolean
  t: (key: string) => string
  onSave: (provider: string, model: string, table: Record<string, string>) => Promise<{ ok: boolean; problems?: string[] }>
}) {
  const current: Record<string, string> =
    props.table && typeof props.table === 'object'
      ? Object.fromEntries(Object.entries(props.table).map(([k, v]) => [k, v ?? '']))
      : {}
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...current }))
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [problems, setProblems] = useState<string[]>([])
  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(draft), ...Object.keys(current)])
    for (const key of keys) if ((draft[key] ?? undefined) !== (current[key] ?? undefined)) return true
    return false
  }, [draft, current])

  const toggle = (level: string, on: boolean) => {
    setState('idle')
    setProblems([])
    setDraft((prev) => {
      const next = { ...prev }
      if (on) next[level] = level === 'off' ? '' : (next[level] ?? level)
      else delete next[level]
      return next
    })
  }
  const setWire = (level: string, wire: string) => {
    setState('idle')
    setProblems([])
    setDraft((prev) => ({ ...prev, [level]: wire }))
  }

  return (
    <div className="er-model">
      <div className="er-model-head">
        <span className="er-model-id" title={props.provider + '/' + props.model}>{props.model}</span>
        <button
          type="button"
          className="er-btn"
          data-primary={dirty}
          disabled={!dirty || props.readonly}
          onClick={async () => {
            // Pre-validate exactly the way the pi-ai gate will, so a bad table
            // is refused HERE with the reason, not there with a bare rejection.
            const local = validateEffortTable(normalizeEffortTable(draft))
            if (local.length > 0) {
              setProblems(local)
              setState('failed')
              return
            }
            const result = await props.onSave(props.provider, props.model, draft)
            setProblems(result.problems ?? [])
            setState(result.ok ? 'saved' : 'failed')
          }}
        >
          {props.t('card.custom.save')}
        </button>
      </div>
      <div className="er-efforts">
        {EDITABLE_LEVELS.map((level) => {
          const checked = level in draft
          return (
            <span key={level} className="er-effort">
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={props.readonly}
                  onChange={(event) => toggle(level, event.currentTarget.checked)}
                />
                {' ' + level}
              </label>
              {checked && (
                <input
                  type="text"
                  value={draft[level] ?? ''}
                  disabled={props.readonly}
                  placeholder={level === 'off' ? props.t('card.custom.offPlaceholder') : props.t('card.custom.wirePlaceholder')}
                  onChange={(event) => setWire(level, event.currentTarget.value)}
                />
              )}
            </span>
          )
        })}
      </div>
      {state === 'saved' && <span className="er-note" data-tone="ok">{props.t('card.custom.saved')}</span>}
      {state === 'failed' && (
        <span className="er-note" data-tone="error">
          {props.t('card.custom.failed')}
          {problems.length > 0 ? '：' + problems.join('；') : ''}
        </span>
      )}
    </div>
  )
}

/** The llm-pi-ai provider/model editor fed by the shared settings scope. */
function CustomModels(props: { piAiScope: any; t: (key: string) => string }) {
  const { piAiScope, t } = props
  const snapshot = useScope(piAiScope)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!snapshot || snapshot.status !== 'ready') {
    return <p>{t('card.custom.unavailable')}</p>
  }
  const providers = (snapshot.value && snapshot.value.providers) || {}
  const readonly = !snapshot.writable

  const saveModel = async (provider: string, model: string, table: Record<string, string>) => {
    try {
      const { next, changed, problems } = withModelEfforts(snapshot.value, provider, model, table)
      if (!changed) return { ok: false, problems }
      await piAiScope.set('providers', next.providers)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  const fillAll = async () => {
    // The card cannot resolve model capability, so the manual fill stays
    // conservative: only rows on explicit custom gateways (api / non-official
    // baseURL). Catalog-route rows are covered by the host's resolution-gated
    // fill at startup, which provably skips models that inherit catalog levels.
    const targets = fillCandidates(snapshot.value).filter((key) => {
      const provider = key.slice(0, key.indexOf('/'))
      return isCustomGateway(providers[provider])
    })
    const { next, filled } = withDefaultEfforts(snapshot.value, { targets })
    if (next === snapshot.value || filled.length === 0) return
    try { await piAiScope.set('providers', next.providers) } catch { /* rejected: leave as is */ }
  }

  const rows: { provider: string; profile: any; custom: boolean }[] = []
  for (const [provider, profile] of Object.entries<any>(providers)) {
    const hasModels = Array.isArray(profile && profile.models) && profile.models.length > 0
    const hasOverrides = profile && profile.modelOverrides && typeof profile.modelOverrides === 'object'
      && Object.keys(profile.modelOverrides).length > 0
    if (hasModels || hasOverrides) {
      rows.push({ provider, profile, custom: isCustomGateway(profile) })
    }
  }
  if (rows.length === 0) return <p>{t('card.custom.empty')}</p>

  const needle = query.trim().toLowerCase()
  const match = (text: string) => !needle || text.toLowerCase().includes(needle)

  return (
    <div>
      <input
        className="er-search"
        type="text"
        value={query}
        placeholder={t('card.custom.search')}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="er-row">
        <label>{t('card.custom.hint')}</label>
      </div>
      <div className="er-row">
        <label />
        <button type="button" className="er-btn" disabled={readonly} onClick={fillAll}>
          {t('card.custom.fillAll')}
        </button>
      </div>
      {rows.map(({ provider, profile, custom }) => {
        const models: { id: string; table: any }[] = []
        if (Array.isArray(profile.models)) {
          for (const row of profile.models) {
            if (row && typeof row === 'object' && typeof row.id === 'string') {
              models.push({ id: row.id, table: row.reasoningEfforts })
            }
          }
        }
        if (profile.modelOverrides && typeof profile.modelOverrides === 'object') {
          for (const [id, row] of Object.entries<any>(profile.modelOverrides)) {
            models.push({ id, table: row && row.reasoningEfforts })
          }
        }
        const visible = models.filter((m) => match(m.id) || match(provider))
        if (visible.length === 0) return null
        const expanded = open[provider] ?? (needle.length > 0)
        return (
          <details
            key={provider}
            className="er-provider"
            open={expanded}
            onToggle={(event) => setOpen((prev) => ({ ...prev, [provider]: (event.target as HTMLDetailsElement).open }))}
          >
            <summary>
              {provider}
              <span className="er-tag">{models.length + ' ' + t('card.custom.models')}</span>
              {custom && <span className="er-tag">{t('card.custom.customRoute')}</span>}
            </summary>
            <div className="er-provider-body">
              {visible.length === 0
                ? <span className="er-note">{t('card.custom.none')}</span>
                : visible.map((m) => (
                  <ModelEditor
                    key={m.id}
                    provider={provider}
                    model={m.id}
                    table={m.table}
                    readonly={readonly}
                    t={t}
                    onSave={saveModel}
                  />
                ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

/** The settings.section card. Props are injected by the slot registration. */
export function SettingsCard(props: { scope: any; piAiScope: any; t: (key: string) => string }) {
  const { scope, piAiScope, t } = props
  const snapshot = useScope(scope)
  if (!snapshot || snapshot.status !== 'ready') {
    return <p>{t('card.custom.unavailable')}</p>
  }
  const value = (snapshot.value || {}) as any
  const readonly = !snapshot.writable
  const set = (path: string, next: unknown) => { scope.set(path, next).catch(() => {}) }

  const routes = value.routes || {}
  const levelOptions = [
    { value: 'auto', label: t('card.defaultLevel.auto') },
    ...['off', 'on', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({ value: level, label: level })),
  ]
  const routeOptions = (allowed: string[]) => allowed.map((tier) => ({ value: tier, label: tier }))

  return (
    <div className="er-card">
      <p>{t('card.description')}</p>

      <SwitchRow label={t('card.enabled')} checked={value.enabled !== false} disabled={readonly}
        onChange={(v) => set('enabled', v)} />
      <SelectRow label={t('card.defaultLevel')} value={value.defaultLevel ?? 'auto'} options={levelOptions}
        disabled={readonly} onChange={(v) => set('defaultLevel', v)} />
      <SelectRow
        label={t('card.subagentEffort')}
        value={value.subagentEffort ?? 'inherit'}
        options={[{ value: 'inherit', label: t('card.subagentInherit') },
          ...['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({ value: level, label: level }))]}
        disabled={readonly}
        onChange={(v) => set('subagentEffort', v)}
      />

      <div className="er-group">
        <h3>{t('card.bounds')}</h3>
        <SwitchRow label={t('card.allowMax')} checked={value.allowMax === true} disabled={readonly}
          onChange={(v) => set('allowMax', v)} />
        <SelectRow label={t('card.maxFallback')} value={value.maxFallback ?? 'high'}
          options={routeOptions(['low', 'high'])} disabled={readonly || value.allowMax === true}
          onChange={(v) => set('maxFallback', v)} />
        <SwitchRow label={t('card.frugalDemote')} checked={value.frugalDemote !== false} disabled={readonly}
          onChange={(v) => set('frugalDemote', v)} />
        <NumberRow label={t('card.contextPressure')} value={Number(value.contextPressure ?? 0.75)}
          min={0} max={1} step={0.05} disabled={readonly} onChange={(v) => set('contextPressure', v)} />
        <NumberRow label={t('card.sessionTokenBudget')} value={Number(value.sessionTokenBudget ?? 0)}
          min={0} step={10000} disabled={readonly} onChange={(v) => set('sessionTokenBudget', v)} />
      </div>

      <div className="er-group">
        <h3>{t('card.routes')}</h3>
        <SelectRow label={t('card.route.trivial')} value={routes.trivial ?? 'low'}
          options={routeOptions(['low', 'high'])} disabled={readonly} onChange={(v) => set('routes.trivial', v)} />
        <SelectRow label={t('card.route.standard')} value={routes.standard ?? 'low'}
          options={routeOptions(['low', 'high'])} disabled={readonly} onChange={(v) => set('routes.standard', v)} />
        <SelectRow label={t('card.route.engineering')} value={routes.engineering ?? 'high'}
          options={routeOptions(['low', 'high', 'max'])} disabled={readonly} onChange={(v) => set('routes.engineering', v)} />
        <SelectRow label={t('card.route.hard')} value={routes.hard ?? 'max'}
          options={routeOptions(['high', 'max'])} disabled={readonly} onChange={(v) => set('routes.hard', v)} />
      </div>

      <details className="er-group">
        <summary>{t('card.advanced')}</summary>
        <NumberRow label={t('card.downAfter')} value={Number(value.downAfter ?? 2)} min={1} max={5}
          disabled={readonly} onChange={(v) => set('downAfter', v)} />
        <NumberRow label={t('card.escalateOnErrors')} value={Number(value.escalateOnErrors ?? 2)} min={1} max={10}
          disabled={readonly} onChange={(v) => set('escalateOnErrors', v)} />
        <NumberRow label={t('card.escalateOnRepeats')} value={Number(value.escalateOnRepeats ?? 3)} min={2} max={10}
          disabled={readonly} onChange={(v) => set('escalateOnRepeats', v)} />
        <NumberRow label={t('card.maxEscalations')} value={Number(value.maxEscalations ?? 2)} min={1} max={3}
          disabled={readonly} onChange={(v) => set('maxEscalations', v)} />
      </details>

      <div className="er-group">
        <h3>{t('card.custom')}</h3>
        <SwitchRow label={t('card.fillCustomModels')} checked={value.fillCustomModels !== false} disabled={readonly}
          onChange={(v) => set('fillCustomModels', v)} />
        {piAiScope ? <CustomModels piAiScope={piAiScope} t={t} /> : null}
      </div>

      {readonly && <p>{t('card.readonly')}</p>}
    </div>
  )
}
