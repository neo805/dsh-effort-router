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
  "badge.poisonedUnsupported": "\u65E0\u6CD5\u4FDD\u6301\u601D\u8003\u5173\u95ED",
  "badge.unsupported": "\u4E0D\u652F\u6301",
  "badge.none": "\u672C\u4F1A\u8BDD\u6682\u65E0\u8C03\u5EA6\u8BB0\u5F55",
  "annotation.default": "\u9ED8\u8BA4"
};
var en = {
  "badge.auto": "Auto",
  "badge.manual": "Manual",
  "badge.default": "Default",
  "badge.subagent": "Subagent",
  "badge.poisoned": "Thinking off",
  "badge.poisonedUnsupported": "Off unavailable",
  "badge.unsupported": "Unsupported",
  "badge.none": "No routing decision in this session yet",
  "annotation.default": "default"
};

// src/client/styles.ts
var STYLE_ID = "effort-router-styles";
var CSS = [
  ".er-badge{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:11px;line-height:18px;white-space:nowrap;cursor:default;user-select:none}",
  ".er-badge-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-label-caption,#8b9096)}",
  '.er-badge[data-on="true"] .er-badge-dot{background:var(--dsw-alias-status-success,#3fb950)}',
  ".er-trj{display:inline-block;margin-right:8px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#8b9096);font-size:10px;line-height:15px;white-space:nowrap;vertical-align:1px}",
  // Chat captions (chatAnnotate opt-in): one compact row under a tool call.
  ".er-call{display:flex;align-items:center;gap:4px;max-width:100%;padding:0 2px;color:var(--dsw-alias-label-caption,#8b9096);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".er-call-model{min-width:0;color:var(--dsw-alias-label-secondary,#a2a8b0);overflow:hidden;text-overflow:ellipsis}",
  ".er-call-eff{flex:none}",
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
  ".er-trj-boundary:hover{color:var(--dsw-alias-label-primary,inherit)}",
  // Keyboard parity: the chip is a real control (role=button, Tab stop), so
  // focus must be visible without a mouse.
  ".er-trj-boundary:focus-visible{outline:1px solid var(--dsw-alias-border-accent,currentColor);outline-offset:1px}"
].join("");
function ensureStyles() {
  if (typeof document === "undefined" || !document.head) return () => {
  };
  const existing = document.getElementById(STYLE_ID);
  let node;
  if (existing) {
    if (existing.textContent !== CSS) existing.textContent = CSS;
    node = existing;
  } else {
    const created = document.createElement("style");
    created.id = STYLE_ID;
    created.textContent = CSS;
    document.head.appendChild(created);
    node = created;
  }
  node.__erStyleRefs = (node.__erStyleRefs || 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const refs = (node.__erStyleRefs || 0) - 1;
    if (refs > 0) {
      node.__erStyleRefs = refs;
      return;
    }
    node.__erStyleRefs = 0;
    if (typeof node.remove === "function") node.remove();
    else if (document.head && Array.isArray(document.head.children)) {
      const at = document.head.children.indexOf(node);
      if (at >= 0) document.head.children.splice(at, 1);
    }
  };
}

// src/client/Badge.tsx
var import_react = require("react");

// src/client/badge-state.js
function badgeForSession(state, sessionId) {
  if (!state || !sessionId) return null;
  return state.sessionId === sessionId ? state : null;
}
function badgeEffortText(last) {
  if (!last || typeof last.effort !== "string" || last.effort === "") return "";
  return last.effort;
}
function sameBadgeState(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.sessionId !== right.sessionId || left.ok !== right.ok || left.enabled !== right.enabled || left.showBadge !== right.showBadge) return false;
  const a = left.last;
  const b = right.last;
  if (a === b) return true;
  if (!a || !b) return false;
  return a.mode === b.mode && a.effort === b.effort && a.tier === b.tier && a.targetTier === b.targetTier && a.targetRank === b.targetRank && a.originClass === b.originClass && a.mapping === b.mapping && a.stepClass === b.stepClass && a.reason === b.reason;
}

// src/client/Badge.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var POLL_MS = 2500;
function Badge(props) {
  const { sessionId, t } = props;
  const [state, setState] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (!sessionId) return;
    setState(null);
    let stopped = false;
    let timer;
    const controller = new AbortController();
    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(tick, POLL_MS * 4);
        return;
      }
      try {
        const response = await fetch(
          "/effort-router/state?view=badge&sessionId=" + encodeURIComponent(sessionId),
          { cache: "no-store", signal: controller.signal }
        );
        if (response.ok) {
          const json = await response.json();
          const next = { ...json, sessionId };
          if (!stopped && !controller.signal.aborted) {
            setState((previous) => sameBadgeState(previous, next) ? previous : next);
          }
        }
      } catch {
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== void 0) clearTimeout(timer);
    };
  }, [sessionId]);
  const owned = badgeForSession(state, sessionId);
  if (!owned || owned.ok !== true || owned.enabled !== true || owned.showBadge === false) return null;
  const last = owned.last;
  const modeKey = last && typeof last.mode === "string" ? last.mode : "auto";
  const modeLabel = (
    // 'manual-stripped' counts as a manual pick (the level was refused by the model)
    modeKey === "manual" || modeKey === "manual-stripped" ? t("badge.manual") : modeKey === "default" ? t("badge.default") : modeKey === "subagent" ? t("badge.subagent") : modeKey === "poisoned" ? t("badge.poisoned") : modeKey === "poisoned-unsupported" ? t("badge.poisonedUnsupported") : modeKey === "unsupported" ? t("badge.unsupported") : t("badge.auto")
  );
  const effort = badgeEffortText(last);
  const label = last ? modeLabel + (effort ? " \xB7 " + effort : "") : modeLabel;
  const tooltip = !last ? t("badge.none") : [
    last.originClass ? `origin: ${last.originClass}` : last.stepClass ? `class: ${last.stepClass}` : "",
    last.targetTier ? `target: ${last.targetTier}${last.targetRank === null || last.targetRank === void 0 ? "" : ` (rank ${last.targetRank})`}` : "",
    last.mapping ? `mapping: ${last.mapping}` : "",
    last.reason || ""
  ].filter(Boolean).join("\n");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "er-badge", "data-on": "true", title: tooltip, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-badge-dot" }),
    label
  ] });
}

// src/client/ids.js
var UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var SESSION_ID_RE = new RegExp("^(?:session-)?" + UUID + "$", "i");
var SESSION_ID_IN_URL_RE = new RegExp("(?:session-)?" + UUID, "i");
function isSessionId(value) {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}
var TOOL_ROW_PREFIX = "tool\0call\0";
function anchorOfRowKey(rowKey) {
  if (typeof rowKey !== "string" || rowKey === "") return null;
  let key;
  try {
    key = decodeURIComponent(rowKey);
  } catch {
    return null;
  }
  if (key.startsWith(TOOL_ROW_PREFIX)) {
    const callId = key.slice(TOOL_ROW_PREFIX.length);
    return callId === "" ? null : callId;
  }
  return key === "" ? null : key;
}

// src/client/poll-guard.js
function createPollGuard() {
  let generation = 0;
  let sessionId = null;
  let hint = null;
  return {
    updateSession(next) {
      const value = typeof next === "string" && next !== "" ? next : null;
      if (value === sessionId) return false;
      sessionId = value;
      hint = null;
      generation += 1;
      return true;
    },
    updateHint(next) {
      if (sessionId !== null) return false;
      const value = typeof next === "string" && next !== "" ? next : null;
      if (value === hint) return false;
      hint = value;
      generation += 1;
      return true;
    },
    snapshot() {
      return { generation, sessionId, hint };
    },
    isCurrent(token) {
      return !!token && token.generation === generation && token.sessionId === sessionId && token.hint === hint;
    }
  };
}

// src/client/trajectory.ts
var POLL_MS2 = 2500;
var FULL_SWEEP_EVERY = 8;
var CAPTION_ATTR = "data-er-trj";
var DONE_ATTR = "data-er-trj-done";
var ROOT_ATTR = "data-conversation-session";
var ROOT_SELECTOR = "[" + ROOT_ATTR + "]";
var ROW_KEY_ATTR = "data-trajectory-row-key";
var ROW_SELECTOR = "tr[" + ROW_KEY_ATTR + "]";
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
function nearestRoot(el) {
  return typeof el.closest === "function" ? el.closest(ROOT_SELECTOR) : null;
}
function sessionOf(root) {
  const id = root.getAttribute(ROOT_ATTR);
  return isSessionId(id) ? id : null;
}
function isRootElement(el) {
  return typeof el.matches === "function" && el.matches(ROOT_SELECTOR);
}
function isRowElement(el) {
  return typeof el.matches === "function" && el.matches(ROW_SELECTOR);
}
function rowsOf(root) {
  const rows = [];
  if (typeof root.querySelectorAll !== "function") return rows;
  for (const node of Array.from(root.querySelectorAll(ROW_SELECTOR))) {
    const tr = node;
    if (nearestRoot(tr) === root) rows.push(tr);
  }
  return rows;
}
function mountInline(tr, caption) {
  const cell = tr.querySelector("td:last-child");
  const target = (cell && cell.firstElementChild) ?? cell ?? tr;
  target.insertAdjacentElement("afterbegin", caption);
}
function requestDotOf(tr) {
  const cell = tr.querySelector("td:first-child");
  const dot = cell ? cell.querySelector("button[data-request-run-index]") : null;
  return dot === null ? null : dot;
}
function requestNumberOf(dot) {
  const label = dot.getAttribute("data-label") || dot.getAttribute("aria-label") || "";
  const match = /#(\d+)/.exec(label);
  return match ? match[1] : "";
}
function mountBoundary(tr, caption, dot) {
  const offset = dot.style.getPropertyValue("--request-boundary-offset") || "0px";
  const left = "calc(30px + " + offset + ")";
  if (caption.style.left !== left) caption.style.left = left;
  const cell = tr.querySelector("td:first-child");
  if (cell && caption.parentElement !== cell) cell.appendChild(caption);
}
function labelOf(anchor) {
  const provider = anchor.provider ? String(anchor.provider) : "";
  const model = anchor.model ? String(anchor.model) : "";
  const route = provider && model ? provider + "/" + model : model || provider;
  const effort = anchor.effort === null || anchor.effort === void 0 || anchor.effort === "" ? "default" : String(anchor.effort);
  return route ? route + " \xB7 " + effort : "";
}
function hashAnchors(table) {
  let h2 = 5381;
  for (const key of Object.keys(table).sort()) {
    const a = table[key];
    const s = key + "|" + (a && a.provider) + "|" + (a && a.model) + "|" + (a && a.effort);
    for (let i = 0; i < s.length; i += 1) h2 = (h2 << 5) + h2 + s.charCodeAt(i) | 0;
  }
  return h2;
}
function startTrajectoryDecorator() {
  if (typeof document === "undefined") return () => {
  };
  let stopped = false;
  const states = /* @__PURE__ */ new Map();
  let roster = null;
  const variant = chipVariant();
  const hasTrajectoryRows = (st) => rowsOf(st.root).length > 0;
  const shedRow = (st, tr) => {
    const caption = st.captions.get(tr);
    if (caption) {
      caption.remove();
      st.captions.delete(tr);
    }
    tr.removeAttribute(DONE_ATTR);
    st.pendingRows.delete(tr);
  };
  const decorateRow = (st, tr) => {
    if (stopped || st.stopped) return;
    const existing = st.captions.get(tr);
    if (existing && !existing.isConnected) {
      if (typeof existing.remove === "function") existing.remove();
      st.captions.delete(tr);
      tr.removeAttribute(DONE_ATTR);
    }
    const isAssistantRow = (tr.getAttribute("data-kind") || "") === "message";
    let anchorId = null;
    if (isAssistantRow) {
      if (st.anchorIds.has(tr)) {
        anchorId = st.anchorIds.get(tr) ?? null;
      } else {
        anchorId = anchorOfRowKey(tr.getAttribute(ROW_KEY_ATTR) || "");
        st.anchorIds.set(tr, anchorId);
      }
    }
    const anchor = anchorId !== null && st.anchors.enabled ? st.anchors.anchors[anchorId] : void 0;
    const label = anchor ? labelOf(anchor) : "";
    const dot = label && isAssistantRow ? requestDotOf(tr) : null;
    const placement = label ? dot !== null ? "b" : "i" : "";
    const requestNo = dot !== null ? requestNumberOf(dot) : "";
    const text = placement === "b" && requestNo !== "" ? "#" + requestNo + " \xB7 " + label : label;
    const skin = placement === "b" ? variant : "";
    const doneValue = placement + "|" + requestNo + "|" + label + "|" + skin;
    if (tr.getAttribute(DONE_ATTR) === doneValue) return;
    tr.setAttribute(DONE_ATTR, doneValue);
    let caption = st.captions.get(tr);
    if (!placement) {
      if (caption) {
        caption.remove();
        st.captions.delete(tr);
      }
      return;
    }
    if (caption && caption.getAttribute("data-er-trj-place") !== placement) {
      caption.remove();
      st.captions.delete(tr);
      caption = void 0;
    }
    if (!caption) {
      caption = document.createElement("span");
      caption.setAttribute(CAPTION_ATTR, "");
      caption.setAttribute("data-er-trj-place", placement);
      st.captions.set(tr, caption);
      if (placement === "b") {
        caption.setAttribute("class", "er-trj-boundary");
        caption.setAttribute("data-er-trj-v", skin);
        caption.setAttribute("role", "button");
        caption.setAttribute("tabindex", "0");
        if ("tabIndex" in caption) caption.tabIndex = 0;
        const activate = () => {
          const target = requestDotOf(tr);
          if (target) target.click();
        };
        caption.addEventListener("click", (event) => {
          event.stopPropagation();
          activate();
        });
        caption.addEventListener("keydown", (event) => {
          const key = event && event.key;
          if (key === "Enter") {
            event.stopPropagation();
            if (event.repeat) return;
            event.preventDefault();
            activate();
            return;
          }
          if (key === " " || key === "Spacebar") {
            event.preventDefault();
            event.stopPropagation();
          }
        });
        caption.addEventListener("keyup", (event) => {
          const key = event && event.key;
          if (key !== " " && key !== "Spacebar") return;
          event.stopPropagation();
          if (event.repeat) return;
          activate();
        });
      } else {
        caption.setAttribute("class", "er-trj");
      }
    }
    if (placement === "b" && dot !== null) mountBoundary(tr, caption, dot);
    else if (placement === "i" && !caption.isConnected) mountInline(tr, caption);
    if (placement === "b" && caption.getAttribute("data-er-trj-v") !== skin) {
      caption.setAttribute("data-er-trj-v", skin);
    }
    caption.setAttribute("title", text);
    if (caption.textContent !== text) caption.textContent = text;
  };
  const flush = (st) => {
    if (stopped || st.stopped || st.pendingRows.size === 0) return;
    const rows = Array.from(st.pendingRows);
    st.pendingRows.clear();
    for (const tr of rows) {
      if (!tr.isConnected || nearestRoot(tr) !== st.root) {
        shedRow(st, tr);
        st.anchorIds.delete(tr);
        continue;
      }
      decorateRow(st, tr);
    }
  };
  const scheduleFrame = (st) => {
    if (stopped || st.stopped || st.rafId !== void 0 || st.pendingRows.size === 0) return;
    if (typeof requestAnimationFrame !== "function") {
      flush(st);
      return;
    }
    st.rafId = requestAnimationFrame(() => {
      st.rafId = void 0;
      flush(st);
    });
  };
  const registerRows = (st) => {
    if (stopped || st.stopped) return;
    for (const tr of rowsOf(st.root)) st.pendingRows.add(tr);
    scheduleFrame(st);
  };
  const clearCaptions = (st) => {
    for (const tr of rowsOf(st.root)) shedRow(st, tr);
    st.pendingRows.clear();
    st.anchors = { enabled: false, anchors: {} };
    st.fingerprint = "";
  };
  const stopPoll = (st) => {
    st.loadId += 1;
    if (st.controller) {
      st.controller.abort();
      st.controller = null;
    }
    st.polling = false;
    if (st.timer !== void 0) {
      clearTimeout(st.timer);
      st.timer = void 0;
    }
  };
  const isCurrent = (st, loadId, token) => !stopped && !st.stopped && st.loadId === loadId && st.guard.isCurrent(token);
  const schedulePoll = (st) => {
    if (stopped || st.stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (st.polling || st.timer !== void 0) return;
    if (!hasTrajectoryRows(st)) return;
    st.timer = setTimeout(() => {
      st.timer = void 0;
      void poll(st);
    }, POLL_MS2);
  };
  const poll = async (st) => {
    if (stopped || st.stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!hasTrajectoryRows(st)) return;
    st.loadId += 1;
    const loadId = st.loadId;
    const token = st.guard.snapshot();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    st.controller = controller;
    st.polling = true;
    try {
      const params = new URLSearchParams();
      params.set("view", "anchors");
      if (token.sessionId) params.set("sessionId", token.sessionId);
      const response = await fetch("/effort-router/state?" + params.toString(), {
        cache: "no-store",
        ...controller ? { signal: controller.signal } : {}
      });
      if (!response.ok) return;
      const json = await response.json();
      if (!isCurrent(st, loadId, token)) return;
      if (!json || json.ok !== true) return;
      const next = {
        enabled: json.trajectoryAnnotate === true,
        anchors: json.anchors && typeof json.anchors === "object" ? json.anchors : {}
      };
      const nextFingerprint = String(next.enabled) + ":" + String(hashAnchors(next.anchors));
      const changed = nextFingerprint !== st.fingerprint;
      st.fingerprint = nextFingerprint;
      st.anchors = next;
      st.polls += 1;
      if (changed || st.polls % FULL_SWEEP_EVERY === 0) {
        registerRows(st);
      }
    } catch {
    } finally {
      if (st.controller === controller) {
        st.controller = null;
        st.polling = false;
      }
      schedulePoll(st);
    }
  };
  const wakeRoot = (st) => {
    if (stopped || st.stopped || st.polling) return;
    if (!hasTrajectoryRows(st)) return;
    if (st.timer !== void 0) {
      clearTimeout(st.timer);
      st.timer = void 0;
    }
    void poll(st);
  };
  const switchSession = (st, id) => {
    if (stopped || st.stopped) return;
    st.sessionId = id;
    st.guard.updateSession(id);
    stopPoll(st);
    clearCaptions(st);
    registerRows(st);
    wakeRoot(st);
  };
  const disposeRoot = (st) => {
    if (st.stopped) return;
    st.stopped = true;
    stopPoll(st);
    if (st.rafId !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(st.rafId);
    st.rafId = void 0;
    if (st.observer) {
      st.observer.disconnect();
      st.observer = null;
    }
    for (const tr of rowsOf(st.root)) shedRow(st, tr);
    st.pendingRows.clear();
    states.delete(st.root);
  };
  const pruneRow = (st, tr) => {
    shedRow(st, tr);
    st.anchorIds.delete(tr);
  };
  const pruneTree = (st, el) => {
    if (isRowElement(el)) pruneRow(st, el);
    if (el.firstElementChild && typeof el.querySelectorAll === "function") {
      for (const row of Array.from(el.querySelectorAll(ROW_SELECTOR))) pruneRow(st, row);
    }
  };
  const handleRootMutations = (st, mutations) => {
    if (stopped || st.stopped) return;
    let rowsAdded = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.attributeName !== ROW_KEY_ATTR) continue;
        const el = mutation.target;
        st.anchorIds.delete(el);
        const caption = st.captions.get(el);
        if (caption) {
          caption.remove();
          st.captions.delete(el);
        }
        el.removeAttribute(DONE_ATTR);
        st.pendingRows.add(el);
        continue;
      }
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (!node || node.nodeType !== 1) continue;
        const el = node;
        if (isRowElement(el)) {
          st.pendingRows.add(el);
          rowsAdded = true;
        } else if (el.firstElementChild && typeof el.querySelectorAll === "function") {
          for (const row of Array.from(el.querySelectorAll(ROW_SELECTOR))) {
            st.pendingRows.add(row);
            rowsAdded = true;
          }
        }
      }
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (!node || node.nodeType !== 1) continue;
        pruneTree(st, node);
      }
    }
    if (rowsAdded) wakeRoot(st);
    scheduleFrame(st);
  };
  const containsRoot = (el) => {
    if (isRootElement(el)) return true;
    return !!el.firstElementChild && typeof el.querySelectorAll === "function" && el.querySelectorAll(ROOT_SELECTOR).length > 0;
  };
  const reconcileRoots = () => {
    if (stopped) return;
    if (typeof document.querySelectorAll !== "function") return;
    const roots = Array.from(document.querySelectorAll(ROOT_SELECTOR));
    const live = /* @__PURE__ */ new Set();
    for (const node of roots) {
      const root = node;
      const id = sessionOf(root);
      if (!id) continue;
      live.add(root);
      const st = states.get(root);
      if (!st) ensureRoot(root, id);
      else if (st.sessionId !== id) switchSession(st, id);
    }
    for (const st of Array.from(states.values())) {
      if (!live.has(st.root) || !st.root.isConnected) disposeRoot(st);
    }
  };
  const handleRosterMutations = (mutations) => {
    if (stopped) return;
    let inspect = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.attributeName === ROOT_ATTR) inspect = true;
        continue;
      }
      for (const node of Array.from(mutation.addedNodes || [])) {
        if (node && node.nodeType === 1 && containsRoot(node)) inspect = true;
      }
      for (const node of Array.from(mutation.removedNodes || [])) {
        if (node && node.nodeType === 1 && containsRoot(node)) inspect = true;
      }
    }
    if (inspect) reconcileRoots();
  };
  const ensureRoot = (root, id) => {
    if (stopped || states.has(root)) return;
    const st = {
      root,
      sessionId: id,
      guard: createPollGuard(),
      anchors: { enabled: false, anchors: {} },
      fingerprint: "",
      polls: 0,
      timer: void 0,
      controller: null,
      polling: false,
      loadId: 0,
      stopped: false,
      observer: null,
      pendingRows: /* @__PURE__ */ new Set(),
      anchorIds: /* @__PURE__ */ new WeakMap(),
      captions: /* @__PURE__ */ new WeakMap(),
      rafId: void 0
    };
    st.guard.updateSession(id);
    states.set(root, st);
    if (typeof MutationObserver === "function") {
      st.observer = new MutationObserver((mutations) => handleRootMutations(st, mutations));
      st.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [ROW_KEY_ATTR]
      });
    }
    registerRows(st);
    wakeRoot(st);
  };
  if (typeof MutationObserver === "function" && document.body) {
    roster = new MutationObserver(handleRosterMutations);
    roster.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [ROOT_ATTR]
    });
  }
  const onVisibilityChange = () => {
    if (stopped) return;
    if (document.visibilityState === "hidden") {
      for (const st of states.values()) stopPoll(st);
      return;
    }
    for (const st of states.values()) wakeRoot(st);
  };
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  reconcileRoots();
  return () => {
    if (stopped) return;
    stopped = true;
    if (roster) {
      roster.disconnect();
      roster = null;
    }
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    for (const st of Array.from(states.values())) disposeRoot(st);
    states.clear();
  };
}

// src/client/annotations.ts
var import_react2 = require("react");
var import_react3 = require("react");
var ROUTE_KIND = "effort-router-route";
var ANCHORS_PROJECTION = "effortRouterAnchors";
var routeRowDefinition = {
  kind: ROUTE_KIND,
  target: "chat",
  match: (event) => event && event.type === "tool/call" ? { id: String(event.data.callId), role: "start" } : null,
  start: (_context, match) => ({
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    turn: match.event.data.turn,
    step: match.event.data.step,
    seq: match.event.seq
  }),
  update: (context) => context.state,
  buildViewNode: (context) => {
    const state = context.state;
    if (state === void 0 || state === null) return null;
    return {
      key: context.key,
      kind: ROUTE_KIND,
      id: context.id,
      target: "chat",
      anchorSeq: state.seq + 0.1,
      location: context.start && context.start.location ? context.start.location : { kind: "unresolved" },
      visibility: "visible",
      data: { callId: state.callId, name: state.name, turn: state.turn, step: state.step }
    };
  }
};
var RouteRow = (0, import_react2.memo)(function RouteRow2(props) {
  let view = null;
  try {
    const read = props && typeof props.useProjection === "function" ? props.useProjection : null;
    view = read ? read(ANCHORS_PROJECTION) : null;
  } catch (_noProjection) {
    view = null;
  }
  try {
    const node = props ? props.node : null;
    const data = node ? node.data : null;
    const callId = data ? String(data.callId || "") : "";
    const call = callId && view && view.anchors ? view.anchors[callId] : null;
    if (!call) return null;
    const provider = call.provider ? String(call.provider) : "";
    const model = call.model ? String(call.model) : "";
    const label = provider && model ? provider + "/" + model : model || provider;
    if (!label) return null;
    const effort = call.effort === null || call.effort === void 0 || call.effort === "" ? props.t ? props.t("annotation.default") : "default" : String(call.effort);
    return (0, import_react3.createElement)(
      "div",
      { className: "er-call", title: label + " \xB7 " + effort },
      (0, import_react3.createElement)("span", { className: "er-call-model" }, label),
      (0, import_react3.createElement)("span", { className: "er-call-eff" }, "\xB7 " + effort)
    );
  } catch (_noRow) {
    return null;
  }
});

// src/client/index.tsx
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ensureStyles(), "effort-router: styles");
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
  ctx.effect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch("/effort-router/state?view=config", { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : null).then((json) => {
      if (cancelled || controller.signal.aborted || !json || json.chatAnnotate !== true) return;
      ctx.inject(["uiConversation"], (scope) => {
        const conversation = scope.uiConversation;
        if (conversation && conversation.events && typeof conversation.events.register === "function") {
          conversation.events.register(routeRowDefinition);
        }
        scope.slots.inject("conversation.chat.node", () => scope.slots.register({
          name: "conversation.chat.node",
          key: ROUTE_KIND,
          locale: NS,
          inject: () => ({ t })
        }, RouteRow));
      });
    }).catch(() => {
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, "effort-router: chat captions (chatAnnotate)");
}

		return module.exports;
	},
});
