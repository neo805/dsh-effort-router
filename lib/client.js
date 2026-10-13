window.__ModuleLoader__.load({
	id: "dsh-effort-router",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/locales.ts
var NS = "effort-router";
var zh = {
  "badge.auto": "Auto",
  "badge.manual": "\u624B\u52A8",
  "badge.default": "\u9ED8\u8BA4",
  "badge.subagent": "\u5B50\u4EE3\u7406",
  "badge.poisoned": "\u601D\u8003\u5173\u95ED",
  "badge.unsupported": "\u4E0D\u652F\u6301",
  "badge.none": "\u672C\u4F1A\u8BDD\u6682\u65E0\u8C03\u5EA6\u8BB0\u5F55"
};
var en = {
  "badge.auto": "Auto",
  "badge.manual": "Manual",
  "badge.default": "Default",
  "badge.subagent": "Subagent",
  "badge.poisoned": "Thinking off",
  "badge.unsupported": "Unsupported",
  "badge.none": "No routing decision in this session yet"
};

// src/client/styles.ts
var STYLE_ID = "effort-router-styles";
var CSS = [
  ".er-badge{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:11px;line-height:18px;white-space:nowrap;cursor:default;user-select:none}",
  ".er-badge-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-label-caption,#8b9096)}",
  '.er-badge[data-on="true"] .er-badge-dot{background:var(--dsw-alias-status-success,#3fb950)}',
  ".er-trj{display:inline-block;margin-right:8px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#8b9096);font-size:10px;line-height:15px;white-space:nowrap;vertical-align:1px}",
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
  ".er-trj-boundary{position:absolute;top:-7px;z-index:6;display:inline-block;box-sizing:border-box;max-width:min(80ch,70vw);padding:0 4px;border-radius:3px;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:9px;line-height:13px;font-family:var(--dsw-mono-font,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none}",
  ".er-trj-boundary:hover{color:var(--dsw-alias-label-primary,inherit)}"
].join("");
function ensureStyles() {
  if (typeof document === "undefined" || !document.head) return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// src/client/Badge.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var POLL_MS = 2500;
function Badge(props) {
  const { sessionId, t } = props;
  const [state, setState] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (!sessionId) return;
    let stopped = false;
    let timer;
    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(tick, POLL_MS * 4);
        return;
      }
      try {
        const response = await fetch("/effort-router/state?sessionId=" + encodeURIComponent(sessionId), {
          cache: "no-store"
        });
        if (response.ok) {
          const json = await response.json();
          if (!stopped) setState(json);
        }
      } catch {
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      if (timer !== void 0) clearTimeout(timer);
    };
  }, [sessionId]);
  if (!state || state.ok !== true || state.enabled !== true || state.showBadge === false) return null;
  const last = state.last;
  const modeKey = last && typeof last.mode === "string" ? last.mode : "auto";
  const modeLabel = (
    // 'manual-stripped' counts as a manual pick (the level was refused by the model)
    modeKey === "manual" || modeKey === "manual-stripped" ? t("badge.manual") : modeKey === "default" ? t("badge.default") : modeKey === "subagent" ? t("badge.subagent") : modeKey === "poisoned" ? t("badge.poisoned") : modeKey === "unsupported" ? t("badge.unsupported") : t("badge.auto")
  );
  const effort = last && (last.effort ?? last.tier);
  const label = last ? modeLabel + (effort ? " \xB7 " + String(effort) : "") : modeLabel;
  const tooltip = !last ? t("badge.none") : [
    last.stepClass ? `class: ${last.stepClass}` : "",
    last.reason || ""
  ].filter(Boolean).join("\n");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "er-badge", "data-on": "true", title: tooltip, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-badge-dot" }),
    label
  ] });
}

// src/client/trajectory.ts
var POLL_MS2 = 2500;
var FULL_SWEEP_EVERY = 8;
var CAPTION_ATTR = "data-er-trj";
var DONE_ATTR = "data-er-trj-done";
var CHIP_VARIANTS = /* @__PURE__ */ new Set(["transparent"]);
var CHIP_VARIANT_DEFAULT = "transparent";
function chipVariant() {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem("er.trj.variant");
    if (v !== null && CHIP_VARIANTS.has(v)) return v;
  } catch {
  }
  return CHIP_VARIANT_DEFAULT;
}
function currentSessionId() {
  if (typeof location === "undefined") return null;
  const match = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(
    location.href
  );
  return match ? match[0] : null;
}
function anchorOf(rowKey) {
  let key;
  try {
    key = decodeURIComponent(rowKey);
  } catch {
    return null;
  }
  const toolPrefix = "tool\0call\0";
  if (key.startsWith(toolPrefix)) return key.slice(toolPrefix.length);
  return key || null;
}
function visibleToolCallId() {
  if (typeof document === "undefined") return null;
  const rows = document.querySelectorAll("tr[data-trajectory-row-key]");
  const toolPrefix = "tool\0call\0";
  for (const row of Array.from(rows)) {
    const raw = row.getAttribute("data-trajectory-row-key") || "";
    let key;
    try {
      key = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (key.startsWith(toolPrefix)) return key.slice(toolPrefix.length);
  }
  return null;
}
function hashAnchors(table) {
  let h = 5381;
  for (const key of Object.keys(table).sort()) {
    const a = table[key];
    const s = key + "|" + (a && a.provider) + "|" + (a && a.model) + "|" + (a && a.effort);
    for (let i = 0; i < s.length; i += 1) h = (h << 5) + h + s.charCodeAt(i) | 0;
  }
  return h;
}
function startTrajectoryDecorator() {
  let stopped = false;
  let anchors = { enabled: false, anchors: {} };
  let fingerprint = "";
  let polls = 0;
  let pollTimer;
  let sessionId = null;
  const pendingRows = /* @__PURE__ */ new Set();
  const unresolvedRows = /* @__PURE__ */ new Set();
  const labeledRows = /* @__PURE__ */ new Set();
  const anchorIds = /* @__PURE__ */ new WeakMap();
  const captions = /* @__PURE__ */ new WeakMap();
  let rafId;
  const labelOf = (anchor) => {
    const provider = anchor.provider ? String(anchor.provider) : "";
    const model = anchor.model ? String(anchor.model) : "";
    const route = provider && model ? provider + "/" + model : model || provider;
    const effort = anchor.effort === null || anchor.effort === void 0 || anchor.effort === "" ? "default" : String(anchor.effort);
    return route ? route + " \xB7 " + effort : "";
  };
  const anchorIdOf = (tr) => {
    let id = anchorIds.get(tr);
    if (id === void 0) {
      id = anchorOf(tr.getAttribute("data-trajectory-row-key") || "");
      anchorIds.set(tr, id);
    }
    return id;
  };
  const mountInline = (tr, caption) => {
    const cell = tr.querySelector("td:last-child");
    const target = (cell && cell.firstElementChild) ?? cell ?? tr;
    target.insertAdjacentElement("afterbegin", caption);
  };
  const requestDotOf = (tr) => {
    const cell = tr.querySelector("td:first-child");
    const dot = cell ? cell.querySelector("button[data-request-run-index]") : null;
    return dot === null ? null : dot;
  };
  const requestNumberOf = (dot) => {
    const label = dot.getAttribute("data-label") || dot.getAttribute("aria-label") || "";
    const match = /#(\d+)/.exec(label);
    return match ? match[1] : "";
  };
  const mountBoundary = (tr, caption, dot) => {
    const offset = dot.style.getPropertyValue("--request-boundary-offset") || "0px";
    const left = "calc(30px + " + offset + ")";
    if (caption.style.left !== left) caption.style.left = left;
    const cell = tr.querySelector("td:first-child");
    if (cell && caption.parentElement !== cell) cell.appendChild(caption);
  };
  const decorateRow = (tr) => {
    const existing = captions.get(tr);
    if (existing && !existing.isConnected) {
      captions.delete(tr);
      tr.removeAttribute(DONE_ATTR);
    }
    const isAssistantRow = (tr.getAttribute("data-kind") || "") === "message";
    const anchorId = isAssistantRow ? anchorIdOf(tr) : null;
    const anchor = anchorId !== null && anchors.enabled ? anchors.anchors[anchorId] : void 0;
    const label = anchor ? labelOf(anchor) : "";
    const dot = label && isAssistantRow ? requestDotOf(tr) : null;
    const placement = label ? dot !== null ? "b" : "i" : "";
    const requestNo = dot !== null ? requestNumberOf(dot) : "";
    const text = placement === "b" && requestNo !== "" ? "#" + requestNo + " \xB7 " + label : label;
    const variant = placement === "b" ? chipVariant() : "";
    const doneValue = placement + "|" + requestNo + "|" + label + "|" + variant;
    if (tr.getAttribute(DONE_ATTR) !== doneValue) {
      tr.setAttribute(DONE_ATTR, doneValue);
      let caption = captions.get(tr);
      if (!placement) {
        if (caption) {
          caption.remove();
          captions.delete(tr);
        }
      } else {
        if (caption && caption.getAttribute("data-er-trj-place") !== placement) {
          caption.remove();
          captions.delete(tr);
          caption = void 0;
        }
        if (!caption) {
          caption = document.createElement("span");
          caption.setAttribute(CAPTION_ATTR, "");
          caption.setAttribute("data-er-trj-place", placement);
          captions.set(tr, caption);
          if (placement === "b") {
            caption.setAttribute("class", "er-trj-boundary");
            caption.setAttribute("data-er-trj-v", variant);
            caption.addEventListener("click", (event) => {
              event.stopPropagation();
              const target = requestDotOf(tr);
              if (target) target.click();
            });
          } else {
            caption.setAttribute("class", "er-trj");
          }
        }
        if (placement === "b" && dot !== null) mountBoundary(tr, caption, dot);
        else if (placement === "i" && !caption.isConnected) mountInline(tr, caption);
        if (placement === "b" && caption.getAttribute("data-er-trj-v") !== variant) {
          caption.setAttribute("data-er-trj-v", variant);
        }
        caption.setAttribute("title", text);
        if (caption.textContent !== text) caption.textContent = text;
      }
    }
    if (label) {
      unresolvedRows.delete(tr);
      labeledRows.add(tr);
    } else {
      labeledRows.delete(tr);
      unresolvedRows.add(tr);
    }
  };
  const clearAllCaptions = () => {
    for (const tr of Array.from(labeledRows)) {
      const caption = captions.get(tr);
      if (caption) {
        caption.remove();
        captions.delete(tr);
      }
      tr.removeAttribute(DONE_ATTR);
      pendingRows.add(tr);
    }
    labeledRows.clear();
    anchors = { enabled: false, anchors: {} };
    fingerprint = "";
  };
  const syncSessionFromRoute = () => {
    const current = currentSessionId();
    if (current !== sessionId) {
      sessionId = current;
      clearAllCaptions();
    }
  };
  const flush = () => {
    if (stopped || typeof document === "undefined") return;
    if (pendingRows.size === 0) return;
    const rows = Array.from(pendingRows);
    pendingRows.clear();
    for (const tr of rows) {
      if (!tr.isConnected) {
        unresolvedRows.delete(tr);
        labeledRows.delete(tr);
        continue;
      }
      decorateRow(tr);
    }
  };
  const scheduleFrame = () => {
    if (rafId !== void 0 || pendingRows.size === 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = void 0;
      flush();
    });
  };
  const registerVisibleRows = () => {
    const rows = document.querySelectorAll("tr[data-trajectory-row-key]");
    for (const row of Array.from(rows)) pendingRows.add(row);
    scheduleFrame();
  };
  const tick = async () => {
    if (stopped) return;
    syncSessionFromRoute();
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      try {
        const params = new URLSearchParams();
        if (sessionId) params.set("sessionId", sessionId);
        else {
          const hint = visibleToolCallId();
          if (hint) params.set("hint", hint);
        }
        const query = params.toString() ? "?" + params.toString() : "";
        const response = await fetch("/effort-router/state" + query, {
          cache: "no-store"
        });
        if (response.ok) {
          const json = await response.json();
          if (!stopped && json && json.ok === true) {
            const next = {
              enabled: json.trajectoryAnnotate === true,
              anchors: json.anchors && typeof json.anchors === "object" ? json.anchors : {}
            };
            const nextFingerprint = String(next.enabled) + ":" + String(hashAnchors(next.anchors));
            const changed = nextFingerprint !== fingerprint;
            fingerprint = nextFingerprint;
            anchors = next;
            polls += 1;
            if (changed || polls % FULL_SWEEP_EVERY === 0) {
              registerVisibleRows();
            } else if (unresolvedRows.size > 0) {
              for (const tr of Array.from(unresolvedRows)) pendingRows.add(tr);
              scheduleFrame();
            }
          }
        }
      } catch {
      }
    }
    pollTimer = setTimeout(tick, POLL_MS2);
  };
  const observer = new MutationObserver((mutations) => {
    if (stopped) return;
    syncSessionFromRoute();
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const el = mutation.target;
        if (typeof el.matches === "function" && el.matches("tr[data-trajectory-row-key]")) {
          anchorIds.delete(el);
          const caption = captions.get(el);
          if (caption) {
            caption.remove();
            captions.delete(el);
          }
          el.removeAttribute(DONE_ATTR);
          pendingRows.add(el);
        }
        continue;
      }
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType !== 1) continue;
        const el = node;
        if (typeof el.matches === "function" && el.matches("tr[data-trajectory-row-key]")) {
          pendingRows.add(el);
        }
        if (typeof el.querySelectorAll === "function") {
          const rows = el.querySelectorAll("tr[data-trajectory-row-key]");
          for (const row of Array.from(rows)) pendingRows.add(row);
        }
      }
      if (unresolvedRows.size > 0 || labeledRows.size > 0 || pendingRows.size > 0) {
        for (const node of Array.from(mutation.removedNodes)) {
          if (node.nodeType !== 1) continue;
          const el = node;
          if (typeof el.matches === "function" && el.matches("tr[data-trajectory-row-key]")) {
            pendingRows.delete(el);
            unresolvedRows.delete(el);
            labeledRows.delete(el);
          }
          if (typeof el.querySelectorAll === "function") {
            const rows = el.querySelectorAll("tr[data-trajectory-row-key]");
            for (const row of Array.from(rows)) {
              pendingRows.delete(row);
              unresolvedRows.delete(row);
              labeledRows.delete(row);
            }
          }
        }
      }
    }
    scheduleFrame();
  });
  if (typeof document !== "undefined" && document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-trajectory-row-key"]
    });
  }
  tick();
  return () => {
    stopped = true;
    observer.disconnect();
    if (pollTimer !== void 0) clearTimeout(pollTimer);
    if (rafId !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
  };
}

// src/client/index.tsx
var inject = ["slots", "locale"];
function apply(ctx) {
  ensureStyles();
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "effort-router: dictionaries");
  ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    name: "conversation.input.right",
    id: "effort-router:badge",
    order: 30,
    locale: NS,
    inject: (sessionId) => ({ sessionId, t })
  }, Badge));
  ctx.effect(() => startTrajectoryDecorator(), "effort-router: trajectory decorator");
}

		return module.exports;
	},
});
