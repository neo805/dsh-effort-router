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
  // Chat captions (chatAnnotate opt-in): one compact row under a tool call.
  '.er-call{display:flex;align-items:center;gap:4px;max-width:100%;padding:0 2px;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.er-call-model{min-width:0;color:var(--dsw-alias-label-secondary,#a2a8b0);overflow:hidden;text-overflow:ellipsis}',
  '.er-call-eff{flex:none}',
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
  // Keyboard parity: the chip is a real control (role=button, Tab stop), so
  // focus must be visible without a mouse.
  '.er-trj-boundary:focus-visible{outline:1px solid var(--dsw-alias-border-accent,currentColor);outline-offset:1px}',
].join('')

/**
 * Reference-counted installer. HMR can dispose generations in ANY order, so
 * the node is shared and the count lives ON the element (a re-evaluated
 * module keeps counting the same node). Every call — a fresh install or a
 * refresh of an existing node — takes one reference; every returned cleanup
 * releases at most once, and the node is removed only when the last
 * reference goes away. That makes "old generation disposes first" and
 * repeated disposal both safe: the live generation keeps the CSS, and the
 * old generation can never remove what it no longer owns.
 */
export function ensureStyles() {
  if (typeof document === 'undefined' || !document.head) return () => {}
  type RefCountedStyle = HTMLElement & { __erStyleRefs?: number }
  const existing = document.getElementById(STYLE_ID) as RefCountedStyle | null
  let node: RefCountedStyle
  if (existing) {
    // CSS is a live asset: an existing node is REFRESHED rather than trusted,
    // so a stale HMR generation cannot leave old rules behind.
    if (existing.textContent !== CSS) existing.textContent = CSS
    node = existing
  } else {
    const created = document.createElement('style')
    created.id = STYLE_ID
    created.textContent = CSS
    document.head.appendChild(created)
    node = created as RefCountedStyle
  }
  node.__erStyleRefs = (node.__erStyleRefs || 0) + 1
  let released = false
  return () => {
    if (released) return
    released = true
    const refs = (node.__erStyleRefs || 0) - 1
    if (refs > 0) {
      node.__erStyleRefs = refs
      return
    }
    node.__erStyleRefs = 0
    if (typeof node.remove === 'function') node.remove()
    else if (document.head && Array.isArray(document.head.children)) {
      const at = document.head.children.indexOf(node)
      if (at >= 0) document.head.children.splice(at, 1)
    }
  }
}
