/**
 * dsh-effort-router client styles. Theme-token based, dark/light safe.
 * The --dsw-* aliases come from the host theme; every one carries a fallback.
 */
export const STYLE_ID = 'effort-router-styles'

export const CSS = [
  '.er-badge{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:11px;line-height:18px;white-space:nowrap;cursor:default;user-select:none}',
  '.er-badge-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-label-caption,#8b9096)}',
  '.er-badge[data-on="true"] .er-badge-dot{background:var(--dsw-alias-status-success,#3fb950)}',
  '.er-card{display:grid;gap:12px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.5}',
  '.er-card h3{margin:0;font-size:13px;font-weight:600}',
  '.er-card p{margin:0;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:12px}',
  '.er-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0}',
  '.er-row>label{flex:1;min-width:0;cursor:pointer}',
  '.er-row select,.er-row input[type="number"],.er-row input[type="text"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;max-width:220px}',
  '.er-row input[type="number"]{width:110px}',
  '.er-group{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;padding:10px 12px;display:grid;gap:4px}',
  '.er-group>summary{cursor:pointer;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary,#a2a8b0);padding:2px 0}',
  '.er-provider{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;margin:6px 0}',
  '.er-provider>summary{cursor:pointer;padding:8px 12px;font-weight:600;display:flex;align-items:center;gap:8px}',
  '.er-provider-body{display:grid;gap:2px;padding:0 12px 10px}',
  '.er-tag{flex:none;font-size:10px;font-weight:400;color:var(--dsw-alias-label-caption,#8b9096);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:999px;padding:0 6px;line-height:16px}',
  '.er-model{display:grid;gap:6px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15))}',
  '.er-model:first-child{border-top:none}',
  '.er-model-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
  '.er-model-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-mono-font,monospace);font-size:12px}',
  '.er-efforts{display:flex;flex-wrap:wrap;gap:6px 14px}',
  '.er-effort{display:inline-flex;align-items:center;gap:5px;font-size:12px}',
  '.er-effort input[type="text"]{width:90px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:2px 6px;font:inherit;font-size:12px}',
  '.er-btn{appearance:none;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.08));color:inherit;border-radius:7px;padding:4px 12px}',
  '.er-btn:hover{background:var(--dsw-alias-bg-layer-4,rgba(127,127,127,.14))}',
  '.er-btn:disabled{opacity:.55;cursor:default}',
  '.er-btn[data-primary="true"]{border-color:var(--dsw-alias-status-info,#2f81f7);color:var(--dsw-alias-status-info,#2f81f7)}',
  '.er-note{font-size:11px;color:var(--dsw-alias-label-caption,#8b9096)}',
  '.er-note[data-tone="error"]{color:var(--dsw-alias-status-error,#f85149)}',
  '.er-note[data-tone="ok"]{color:var(--dsw-alias-status-success,#3fb950)}',
  '.er-search{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:7px;padding:5px 10px;font:inherit;font-size:12px;margin:4px 0 8px}',
  '.er-call{display:flex;align-items:center;gap:4px;max-width:100%;padding:0 2px;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.er-call-model{min-width:0;color:var(--dsw-alias-label-secondary,#a2a8b0);overflow:hidden;text-overflow:ellipsis}',
  '.er-call-eff{flex:none}',
].join('')

export function ensureStyles() {
  if (typeof document === 'undefined' || !document.head) return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
