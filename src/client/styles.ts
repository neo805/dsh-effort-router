/**
 * dsh-effort-router client styles. Theme-token based, dark/light safe.
 * The --dsw-* aliases come from the host theme; every one carries a fallback.
 */
export const STYLE_ID = 'effort-router-styles'

export const CSS = [
  '.er-badge{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:11px;line-height:18px;white-space:nowrap;cursor:default;user-select:none}',
  '.er-badge-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-label-caption,#8b9096)}',
  '.er-badge[data-on="true"] .er-badge-dot{background:var(--dsw-alias-status-success,#3fb950)}',
  '.er-trj{display:inline-block;margin-right:8px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#8b9096);font-size:10px;line-height:15px;white-space:nowrap;vertical-align:1px}',
  // Trajectory request-boundary chip: rides the native "请求 #N" dot at the
  // row boundary (td.event is overflow:visible), 9px mono like the dot's own
  // hover label. Skin settled on TRANSPARENT after the rc.3/rc.4 A/B round
  // (maintainer's pick): text only, nothing painted behind it — the row
  // separator strokes through the glyphs and reads fine in practice. The
  // rejected skins stay here commented for any future revisit:
  //
  //   under (solid chip below the kind chips): needs the event cell to be
  //     its own stacking context or z-index:-1 sinks below the pane
  //     background and disappears:
  //     'tr[data-trajectory-row-key]>td:first-child{isolation:isolate}',
  //     '.er-trj-boundary[data-er-trj-v="under"]{z-index:-1;background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
  //   solid (rc.2 look, fully on top — clips 1-2px of the kind chips):
  //     '.er-trj-boundary[data-er-trj-v="solid"]{background:var(--dsw-alias-bg-layer-1,#fff);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
  //   gradient (solid band hugging the separator, ~2px core + ~1.8px ramps):
  //     '.er-trj-boundary[data-er-trj-v="gradient"]{background:linear-gradient(to bottom,transparent 0,transparent 34%,var(--dsw-alias-bg-layer-1,#fff) 46%,var(--dsw-alias-bg-layer-1,#fff) 54%,transparent 66%,transparent 100%)}',
  // Width is CONTENT-DRIVEN (0.2.7-rc.6): the rc.5 fixed max-width:190px
  // ellipsized longer provider/model ids ("...") — the chip now sizes to its
  // text and only a generous viewport guard (longer than any real caption,
  // ~80 chars) can still truncate; the full caption always sits in `title`.
  '.er-trj-boundary{position:absolute;top:-7px;z-index:6;display:inline-block;box-sizing:border-box;max-width:min(80ch,70vw);padding:0 4px;border-radius:3px;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:9px;line-height:13px;font-family:var(--dsw-mono-font,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none}',
  '.er-trj-boundary:hover{color:var(--dsw-alias-label-primary,inherit)}',
].join('')

export function ensureStyles() {
  if (typeof document === 'undefined' || !document.head) return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
