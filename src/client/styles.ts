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
  '.er-row-top{align-items:flex-start}',
  '.er-cues{width:220px;max-width:260px;resize:vertical;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;font-family:var(--dsw-mono-font,monospace)}',
  '.er-trj{display:inline-block;margin-right:8px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#8b9096);font-size:10px;line-height:15px;white-space:nowrap;vertical-align:1px}',
  // Trajectory request-boundary chip: rides the native "请求 #N" dot at the
  // row boundary (td.event is overflow:visible), 9px mono like the dot's own
  // hover label. The boundary zone is only ~6px deep per row side, so the
  // skin is switchable while we A/B the look: localStorage "er.trj.variant"
  // = under | solid | transparent | gradient (default under).
  '.er-trj-boundary{position:absolute;top:-7px;z-index:6;display:inline-block;box-sizing:border-box;max-width:190px;padding:0 4px;border-radius:3px;border:.5px solid transparent;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:9px;line-height:13px;font-family:var(--dsw-mono-font,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none}',
  '.er-trj-boundary:hover{color:var(--dsw-alias-label-primary,inherit)}',
  // under needs the event cell to be its own stacking context first: a bare
  // z-index:-1 sinks below the table pane's background and disappears
  // (rc.3). isolation:isolate on the cell makes the chip paint at the
  // bottom of the CELL's content stack — below the in-flow kind chips,
  // above the pane background. Attribute selector only, no hashed native
  // class names; additive and reversible.
  'tr[data-trajectory-row-key]>td:first-child{isolation:isolate}',
  '.er-trj-boundary[data-er-trj-v="under"]{z-index:-1;background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
  // solid: the rc.2 look, fully on top.
  '.er-trj-boundary[data-er-trj-v="solid"]{background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
  '.er-trj-boundary[data-er-trj-v="solid"]:hover{border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.5))}',
  // transparent: text only; the row separator strokes through the glyphs.
  '.er-trj-boundary[data-er-trj-v="transparent"]{background:transparent}',
  // gradient: a NARROW solid band hugging the separator (rc.4 retune — the
  // rc.3 band was too wide). The box is ~15px tall; only the middle ~4px
  // get coverage (a ~2px full-solid core plus ~1.8px ramps), everything
  // else stays transparent so the neighbouring kind chips are never
  // touched. Same negligible GPU cost as rc.3.
  '.er-trj-boundary[data-er-trj-v="gradient"]{background:linear-gradient(to bottom,transparent 0,transparent 34%,var(--dsw-alias-bg-layer-1,#fff) 46%,var(--dsw-alias-bg-layer-1,#fff) 54%,transparent 66%,transparent 100%)}',
].join('')

export function ensureStyles() {
  if (typeof document === 'undefined' || !document.head) return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
