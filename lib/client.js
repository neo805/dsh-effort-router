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
  "section.title": "\u601D\u8003\u5F3A\u5EA6\u8DEF\u7531",
  "card.description": "\u6309\u6B65\u9AA4\u81EA\u52A8\u8C03\u5EA6\u601D\u8003\u6863\u4F4D\uFF1A\u5206\u7C7B\u4EFB\u52A1\u5F62\u6001 \u2192 \u8BC1\u636E\u5347\u7EA7 \u2192 \u8FDF\u6EDE\u7A33\u5B9A \u2192 \u94B3\u5236\u5230\u6A21\u578B\u652F\u6301\u7684\u6863\u4F4D\u3002\u6A21\u578B\u9009\u62E9\u5668\u91CC\u9009 Auto \u5373\u4EA4\u7ED9\u8C03\u5EA6\u5668\uFF1B\u9009\u5177\u4F53\u6863\u4F4D\u5219\u5B8C\u5168\u76F4\u901A\uFF0C\u624B\u52A8\u9009\u62E9\u6C38\u8FDC\u4F18\u5148\u3002",
  "card.enabled": "\u542F\u7528",
  "card.defaultLevel": "\u65E0\u663E\u5F0F\u9009\u62E9\u65F6\u7684\u6863\u4F4D",
  "card.defaultLevel.auto": "auto \u2014 \u6309\u4E0A\u4E0B\u6587\u81EA\u52A8\u8C03\u5EA6\uFF08\u9ED8\u8BA4\uFF09",
  "card.subagentEffort": "\u5B50\u4EE3\u7406\u9ED8\u8BA4\u6863\u4F4D",
  "card.subagentInherit": "\u7EE7\u627F\uFF08\u8DDF\u968F\u81EA\u52A8\u8C03\u5EA6\uFF09",
  "card.bounds": "\u8C03\u5EA6\u8FB9\u754C",
  "card.allowMax": "\u5141\u8BB8\u81EA\u52A8\u5347\u5230 max\uFF08\u9ED8\u8BA4\u5F00\uFF1B\u66F4\u8D35\u66F4\u6162\uFF0C\u4EC5\u91CD\u4EFB\u52A1\u53D7\u76CA\uFF09",
  "card.maxFallback": "max \u672A\u5141\u8BB8\u65F6\u7684\u56DE\u9000\u6863",
  "card.wish": "\u8BB8\u613F\u68C0\u6D4B\uFF1A\u59D4\u6258\u5F0F\u77ED\u7B80\u62A5\u6309 engineering \u8D77\u6B65\uFF08\u9ED8\u8BA4\u5F00\uFF09",
  "card.poisonRecovery": "\u6BD2\u5316\u6062\u590D\uFF1A\u786E\u8BC1\u624B\u52A8 off \u6B65\u9AA4\u5E26\u5DE5\u5177\u8C03\u7528\u65F6\u4FDD\u6301 off\uFF08\u9ED8\u8BA4\u5F00\uFF1B\u4EC5\u51ED\u6D88\u606F\u5F62\u6001\u6C38\u4E0D\u9489\u6B7B\uFF09",
  "card.trajectoryAnnotate": "\u8F68\u8FF9\u63D0\u7EA7\uFF1A\u5728\u539F\u751F\u8F68\u8FF9\u884C\u4E0A\u663E\u793A provider/model \xB7 \u6863\u4F4D\uFF08\u9ED8\u8BA4\u5F00\uFF1BDOM \u6295\u5F71\uFF0C\u4E0D\u52A8\u5BBF\u4E3B\u5305\uFF09",
  "card.frugalDemote": "\u8282\u4FED\u4FE1\u53F7\u964D\u4E00\u6863\uFF08\u5B50\u4EE3\u7406 / \u4E0A\u4E0B\u6587\u538B\u529B / token \u9884\u7B97\uFF09",
  "card.contextPressure": "\u4E0A\u4E0B\u6587\u538B\u529B\u9608\u503C\uFF080\u20131\uFF0C0 \u5173\u95ED\uFF09",
  "card.sessionTokenBudget": "\u4F1A\u8BDD token \u9884\u7B97\uFF080 \u5173\u95ED\uFF09",
  "card.advanced": "\u9AD8\u7EA7\uFF08\u4FEE\u6539\u540E\u91CD\u8F7D\u63D2\u4EF6\u751F\u6548\uFF09",
  "card.downAfter": "\u964D\u6863\u8FDF\u6EDE\uFF1A\u8FDE\u7EED\u5B89\u9759\u6B21\u6570",
  "card.escalateOnErrors": "\u5347\u6863\u9608\u503C\uFF1A\u5DE5\u5177\u9519\u8BEF\u6570",
  "card.escalateOnRepeats": "\u5347\u6863\u9608\u503C\uFF1A\u91CD\u590D\u8C03\u7528\u6570",
  "card.maxEscalations": "\u5355\u4EFB\u52A1\u5347\u6863\u4E0A\u9650",
  "card.cues.hint": "\u81EA\u5B9A\u4E49\u7EBF\u7D22\u8BCD\uFF08\u6BCF\u884C\u4E00\u4E2A\u6216\u9017\u53F7\u5206\u9694\uFF0C\u8FFD\u52A0\u5230\u5185\u7F6E\u8BCD\u5178\u4E4B\u4E0A\uFF09\uFF1A",
  "card.cues.strong": "strong \u5DE5\u7A0B\u7EBF\u7D22\uFF08\u547D\u4E2D\u5373\u5347 engineering\uFF09",
  "card.cues.normal": "normal \u8F7B\u7EBF\u7D22\uFF08\u53EA\u52A0\u89C2\u6D4B\u5206\uFF09",
  "card.cues.cheap": "cheap \u7410\u788E\u610F\u56FE\uFF08\u77ED\u7B80\u62A5\u5224 trivial\uFF09",
  "card.cues.wish": "wish \u8BB8\u613F\u7EBF\u7D22\uFF08\u771F\u7A7A\u533A\u59D4\u6258\u52A8\u8BCD\uFF09",
  "card.routes": "\u5206\u7C7B \u2192 \u6863\u4F4D\u8DEF\u7531\u8868",
  "card.route.trivial": "trivial\uFF08\u7410\u788E\u77ED\u4EFB\u52A1\uFF09",
  "card.route.standard": "standard\uFF08\u5E38\u89C4\uFF09",
  "card.route.engineering": "engineering\uFF08\u5DE5\u7A0B\u4EFB\u52A1\uFF09",
  "card.route.hard": "hard\uFF08\u91CD\u4EFB\u52A1\uFF09",
  "card.custom": "\u81EA\u5B9A\u4E49\u6A21\u578B\uFF08llm-pi-ai\uFF09",
  "card.fillCustomModels": "\u81EA\u52A8\u4E3A\u624B\u5199\u7684\u81EA\u5B9A\u4E49\u6A21\u578B\u8865\u9F50\u9ED8\u8BA4\u6863\u4F4D\uFF08low / high / max\uFF0C\u4E0D\u542B off\uFF09",
  "card.custom.hint": "\u52FE\u9009\u6863\u4F4D\u5E76\u586B\u5199\u53D1\u9001\u7ED9\u7F51\u5173\u7684\u7EBF\u4E0A\u503C\uFF08\u5982 high \u2192 ultra\uFF09\uFF1Boff \u7559\u7A7A\u8868\u793A\u4E0D\u53D1\u9001\u8BE5\u53C2\u6570\u3002\u4FDD\u5B58\u5199\u5165 llm-pi-ai \u914D\u7F6E\uFF0C\u4E0B\u4E00\u8BF7\u6C42\u751F\u6548\u3002",
  "card.custom.empty": "llm-pi-ai \u4E2D\u6CA1\u6709\u5DF2\u914D\u7F6E\u6A21\u578B\u7684\u63D0\u4F9B\u65B9\u3002\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 \u6A21\u578B\u300D\u6DFB\u52A0\u63D0\u4F9B\u65B9\u4E0E\u6A21\u578B\u3002",
  "card.custom.unavailable": "llm-pi-ai \u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\u4E0D\u53EF\u7528\u3002",
  "card.custom.search": "\u641C\u7D22\u6A21\u578B\uFF08\u540D\u79F0\u6216 ID\uFF09\u2026",
  "card.custom.offPlaceholder": "\u7559\u7A7A = \u4E0D\u53D1\u9001",
  "card.custom.wirePlaceholder": "\u7EBF\u4E0A\u503C\uFF0C\u5982 ultra",
  "card.custom.save": "\u4FDD\u5B58",
  "card.custom.saved": "\u5DF2\u4FDD\u5B58",
  "card.custom.failed": "\u4FDD\u5B58\u5931\u8D25\uFF1A\u914D\u7F6E\u88AB\u62D2\u7EDD\uFF0C\u8BF7\u68C0\u67E5\u503C",
  "card.custom.fillAll": "\u4E00\u952E\u8865\u9F50\u7F3A\u5931\u6863\u4F4D",
  "card.custom.customRoute": "\u81EA\u5B9A\u4E49\u7F51\u5173",
  "card.custom.models": "\u4E2A\u6A21\u578B",
  "card.readonly": "\u53EA\u8BFB\uFF08\u5F53\u524D\u914D\u7F6E\u7531\u66F4\u9AD8\u5C42\u914D\u7F6E\u63D0\u4F9B\uFF09",
  "badge.auto": "Auto",
  "badge.manual": "\u624B\u52A8",
  "badge.default": "\u9ED8\u8BA4",
  "badge.subagent": "\u5B50\u4EE3\u7406",
  "badge.poisoned": "\u601D\u8003\u5173\u95ED",
  "badge.unsupported": "\u4E0D\u652F\u6301",
  "badge.none": "\u672C\u4F1A\u8BDD\u6682\u65E0\u8C03\u5EA6\u8BB0\u5F55"
};
var en = {
  "section.title": "Effort Router",
  "card.description": "Schedules the reasoning effort per step: classify the task shape, escalate on evidence, stabilize with hysteresis, clamp to what the model advertises. Pick Auto in the model selector to hand effort to the scheduler; pick a concrete level to pass it through \u2014 a manual choice always wins.",
  "card.enabled": "Enabled",
  "card.defaultLevel": "Level when nothing is selected",
  "card.defaultLevel.auto": "auto \u2014 schedule from context (default)",
  "card.subagentEffort": "Subagent default",
  "card.subagentInherit": "Inherit (follow the scheduler)",
  "card.bounds": "Scheduling bounds",
  "card.allowMax": "Allow auto max (default on; slower and pricier, only hard tasks gain)",
  "card.maxFallback": "Fallback while max is disallowed",
  "card.wish": "Wish detector: delegation-style short briefs start at engineering (default on)",
  "card.poisonRecovery": "Poison recovery: pin off only on proven manual-off tool turns (default on; message shape alone never pins)",
  "card.trajectoryAnnotate": "Trajectory hoisting: show provider/model \xB7 effort on native trajectory rows (default on; DOM projection, host packages untouched)",
  "card.frugalDemote": "Frugal signals demote one class (subagent / context pressure / token budget)",
  "card.contextPressure": "Context pressure threshold (0\u20131, 0 disables)",
  "card.sessionTokenBudget": "Session token budget (0 disables)",
  "card.advanced": "Advanced (applies on plugin reload)",
  "card.downAfter": "Downgrade hysteresis: quiet steps required",
  "card.escalateOnErrors": "Escalation: tool errors",
  "card.escalateOnRepeats": "Escalation: repeated calls",
  "card.maxEscalations": "Escalation cap per task",
  "card.cues.hint": "Custom cues (one per line or comma-separated, appended on top of the built-in dictionaries):",
  "card.cues.strong": "strong engineering cues (any hit -> engineering)",
  "card.cues.normal": "normal light cues (telemetry score only)",
  "card.cues.cheap": "cheap intent cues (short brief -> trivial)",
  "card.cues.wish": "wish cues (vacuum-zone delegation verbs)",
  "card.routes": "Class \u2192 tier route table",
  "card.route.trivial": "trivial (cheap, short)",
  "card.route.standard": "standard",
  "card.route.engineering": "engineering",
  "card.route.hard": "hard (heavy)",
  "card.custom": "Custom models (llm-pi-ai)",
  "card.fillCustomModels": "Auto-fill default levels (low / high / max, no off) for hand-declared custom models",
  "card.custom.hint": "Tick a level and enter the exact value sent to the gateway (e.g. high \u2192 ultra); an empty off omits the parameter. Saving writes the llm-pi-ai config and applies to the next request.",
  "card.custom.empty": "No provider has models configured in llm-pi-ai. Add a provider and models under Settings \u2192 Models first.",
  "card.custom.unavailable": "The llm-pi-ai settings namespace is unavailable.",
  "card.custom.search": "Search models by name or ID\u2026",
  "card.custom.offPlaceholder": "empty = omit",
  "card.custom.wirePlaceholder": "wire value, e.g. ultra",
  "card.custom.save": "Save",
  "card.custom.saved": "Saved",
  "card.custom.failed": "Save failed: the configuration was rejected; check the values",
  "card.custom.fillAll": "Fill missing levels everywhere",
  "card.custom.customRoute": "custom gateway",
  "card.custom.models": "models",
  "card.readonly": "Read-only (the active value comes from a higher configuration layer)",
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
  ".er-card{display:grid;gap:12px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.5}",
  ".er-card h3{margin:0;font-size:13px;font-weight:600}",
  ".er-card p{margin:0;color:var(--dsw-alias-label-secondary,#a2a8b0);font-size:12px}",
  ".er-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0}",
  ".er-row>label{flex:1;min-width:0;cursor:pointer}",
  '.er-row select,.er-row input[type="number"],.er-row input[type="text"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;max-width:220px}',
  '.er-row input[type="number"]{width:110px}',
  ".er-group{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;padding:10px 12px;display:grid;gap:4px}",
  ".er-group>summary{cursor:pointer;font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary,#a2a8b0);padding:2px 0}",
  ".er-provider{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:10px;margin:6px 0}",
  ".er-provider>summary{cursor:pointer;padding:8px 12px;font-weight:600;display:flex;align-items:center;gap:8px}",
  ".er-provider-body{display:grid;gap:2px;padding:0 12px 10px}",
  ".er-tag{flex:none;font-size:10px;font-weight:400;color:var(--dsw-alias-label-caption,#8b9096);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:999px;padding:0 6px;line-height:16px}",
  ".er-model{display:grid;gap:6px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15))}",
  ".er-model:first-child{border-top:none}",
  ".er-model-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
  ".er-model-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-mono-font,monospace);font-size:12px}",
  ".er-efforts{display:flex;flex-wrap:wrap;gap:6px 14px}",
  ".er-effort{display:inline-flex;align-items:center;gap:5px;font-size:12px}",
  '.er-effort input[type="text"]{width:90px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:2px 6px;font:inherit;font-size:12px}',
  ".er-btn{appearance:none;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.08));color:inherit;border-radius:7px;padding:4px 12px}",
  ".er-btn:hover{background:var(--dsw-alias-bg-layer-4,rgba(127,127,127,.14))}",
  ".er-btn:disabled{opacity:.55;cursor:default}",
  '.er-btn[data-primary="true"]{border-color:var(--dsw-alias-status-info,#2f81f7);color:var(--dsw-alias-status-info,#2f81f7)}',
  ".er-note{font-size:11px;color:var(--dsw-alias-label-caption,#8b9096)}",
  '.er-note[data-tone="error"]{color:var(--dsw-alias-status-error,#f85149)}',
  '.er-note[data-tone="ok"]{color:var(--dsw-alias-status-success,#3fb950)}',
  ".er-search{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:7px;padding:5px 10px;font:inherit;font-size:12px;margin:4px 0 8px}",
  ".er-row-top{align-items:flex-start}",
  ".er-cues{width:220px;max-width:260px;resize:vertical;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;font-family:var(--dsw-mono-font,monospace)}",
  ".er-trj{display:inline-block;margin-right:8px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#8b9096);font-size:10px;line-height:15px;white-space:nowrap;vertical-align:1px}"
].join("");
function ensureStyles() {
  if (typeof document === "undefined" || !document.head) return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// src/client/SettingsCard.tsx
var import_react = require("react");

// lib/custom-models.js
var OFFICIAL_HOST_RE = /(?:^|\.)(?:deepseek\.com|openai\.com|openrouter\.ai|anthropic\.com|googleapis\.com|ai\.google\.dev|mistral\.ai|x\.ai)$/i;
var DEFAULT_EFFORT_TABLE = Object.freeze({ low: "low", high: "high", max: "max" });
function validateEffortTable(table) {
  const problems = [];
  if (!table || typeof table !== "object" || Array.isArray(table)) return ["table must be an object"];
  const keys = Object.keys(table);
  if (keys.length === 0) return ["table is empty"];
  for (const [level, wire] of Object.entries(table)) {
    if (wire === null || wire === void 0 || wire === "") {
      if (level !== "off") problems.push(level + ': only "off" may omit the wire value');
    } else if (typeof wire !== "string") {
      problems.push(level + ": wire value must be a string");
    } else if (wire.trim().length === 0) {
      problems.push(level + ": wire value is blank");
    }
  }
  if (!keys.some((level) => level !== "off")) problems.push('table offers no level beyond "off"');
  return problems;
}
function normalizeEffortTable(levels) {
  const table = {};
  for (const [level, wire] of Object.entries(levels || {})) {
    if (typeof level !== "string" || level.length === 0) continue;
    const value = typeof wire === "string" ? wire.trim() : "";
    if (value.length > 0) table[level] = value;
    else if (level === "off") table[level] = null;
  }
  return table;
}
function needsReasoningCompat(profile, row) {
  if (!profile || profile.api !== "openai-completions") return false;
  if (row && row.compat && row.compat.supportsReasoningEffort !== void 0) return false;
  if (profile.compat && profile.compat.supportsReasoningEffort !== void 0) return false;
  return true;
}
function isCustomGateway(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (typeof profile.api === "string" && profile.api.length > 0) return true;
  const baseURL = profile.baseURL;
  if (typeof baseURL !== "string" || baseURL.length === 0) return false;
  try {
    return !OFFICIAL_HOST_RE.test(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}
function fillCandidates(section) {
  const out = [];
  const providers = section && typeof section === "object" ? section.providers : void 0;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return out;
  for (const [providerId, profile] of Object.entries(providers)) {
    if (!profile || typeof profile !== "object") continue;
    if (Array.isArray(profile.models)) {
      for (const row of profile.models) {
        if (row && typeof row === "object" && typeof row.id === "string" && row.reasoningEfforts === void 0) {
          out.push(providerId + "/" + row.id);
        }
      }
    }
    const overrides = profile.modelOverrides;
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      for (const [modelId, row] of Object.entries(overrides)) {
        if (row && typeof row === "object" && row.reasoningEfforts === void 0) {
          out.push(providerId + "/" + modelId);
        }
      }
    }
  }
  return out;
}
function withDefaultEfforts(section, opts) {
  const providers = section && typeof section === "object" ? section.providers : void 0;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return { next: section, filled: [] };
  }
  const targets = new Set(opts && opts.targets || []);
  if (targets.size === 0) return { next: section, filled: [] };
  const table = opts && opts.table || DEFAULT_EFFORT_TABLE;
  const filled = [];
  let nextProviders;
  for (const [providerId, profile] of Object.entries(providers)) {
    if (!profile || typeof profile !== "object") continue;
    let nextProfile = profile;
    if (Array.isArray(profile.models)) {
      let nextModels;
      profile.models.forEach((row, index) => {
        if (typeof row !== "object" || row === null) return;
        if (row.reasoningEfforts !== void 0) return;
        const key = providerId + "/" + (typeof row.id === "string" ? row.id : "#" + index);
        if (!targets.has(key)) return;
        if (nextModels === void 0) nextModels = [...profile.models];
        const nextRow = { ...row, reasoningEfforts: { ...table } };
        if (needsReasoningCompat(profile, row)) {
          nextRow.compat = { ...row.compat && typeof row.compat === "object" ? row.compat : {}, supportsReasoningEffort: true };
        }
        nextModels[index] = nextRow;
        filled.push(key);
      });
      if (nextModels !== void 0) nextProfile = { ...nextProfile, models: nextModels };
    }
    const overrides = profile.modelOverrides;
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      let nextOverrides;
      for (const [modelId, row] of Object.entries(overrides)) {
        if (!row || typeof row !== "object" || row.reasoningEfforts !== void 0) continue;
        const key = providerId + "/" + modelId;
        if (!targets.has(key)) continue;
        if (nextOverrides === void 0) nextOverrides = { ...overrides };
        const nextRow = { ...row, reasoningEfforts: { ...table } };
        if (needsReasoningCompat(profile, row)) {
          nextRow.compat = { ...row.compat && typeof row.compat === "object" ? row.compat : {}, supportsReasoningEffort: true };
        }
        nextOverrides[modelId] = nextRow;
        filled.push(key);
      }
      if (nextOverrides !== void 0) nextProfile = { ...nextProfile, modelOverrides: nextOverrides };
    }
    if (nextProfile !== profile) {
      if (nextProviders === void 0) nextProviders = { ...providers };
      nextProviders[providerId] = nextProfile;
    }
  }
  if (nextProviders === void 0) return { next: section, filled };
  return { next: { ...section, providers: nextProviders }, filled };
}
function withModelEfforts(section, providerId, modelId, levels) {
  const providers = section && typeof section === "object" ? section.providers : void 0;
  if (!providers || typeof providers !== "object") {
    return { next: section, changed: false, table: {}, problems: ["no providers"] };
  }
  const profile = providers[providerId];
  if (!profile || typeof profile !== "object") {
    return { next: section, changed: false, table: {}, problems: ["unknown provider " + providerId] };
  }
  const table = normalizeEffortTable(levels);
  const problems = validateEffortTable(table);
  if (problems.length > 0) return { next: section, changed: false, table, problems };
  const rowCompat = (row) => needsReasoningCompat(profile, row) ? { ...row.compat && typeof row.compat === "object" ? row.compat : {}, supportsReasoningEffort: true } : void 0;
  if (Array.isArray(profile.models)) {
    const index = profile.models.findIndex(
      (row) => row && typeof row === "object" && row.id === modelId
    );
    if (index < 0) return { next: section, changed: false, table, problems: ["unknown model " + modelId] };
    const nextModels = [...profile.models];
    const compat = rowCompat(nextModels[index]);
    nextModels[index] = {
      ...nextModels[index],
      reasoningEfforts: table,
      ...compat ? { compat } : {}
    };
    return {
      next: { ...section, providers: { ...providers, [providerId]: { ...profile, models: nextModels } } },
      changed: true,
      table,
      problems: []
    };
  }
  const overrides = profile.modelOverrides;
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides) && overrides[modelId]) {
    const compat = rowCompat(overrides[modelId]);
    const nextOverrides = {
      ...overrides,
      [modelId]: {
        ...overrides[modelId],
        reasoningEfforts: table,
        ...compat ? { compat } : {}
      }
    };
    return {
      next: { ...section, providers: { ...providers, [providerId]: { ...profile, modelOverrides: nextOverrides } } },
      changed: true,
      table,
      problems: []
    };
  }
  return { next: section, changed: false, table, problems: ["unknown model " + modelId] };
}

// src/client/SettingsCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var EDITABLE_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function useScope(scope) {
  return (0, import_react.useSyncExternalStore)(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot()
  );
}
function SwitchRow(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: props.label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "checkbox",
        checked: props.checked,
        disabled: props.disabled,
        onChange: (event) => props.onChange(event.currentTarget.checked)
      }
    )
  ] });
}
function SelectRow(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: props.label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "select",
      {
        value: props.value,
        disabled: props.disabled,
        onChange: (event) => props.onChange(event.currentTarget.value),
        children: props.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: option.value, children: option.label }, option.value))
      }
    )
  ] });
}
function NumberRow(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: props.label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "number",
        value: String(props.value),
        min: props.min,
        max: props.max,
        step: props.step ?? 1,
        disabled: props.disabled,
        onChange: (event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) props.onChange(next);
        }
      }
    )
  ] });
}
function CuesRow(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-row er-row-top", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: props.label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "textarea",
      {
        className: "er-cues",
        rows: 2,
        value: props.value,
        disabled: props.disabled,
        onChange: (event) => props.onChange(event.currentTarget.value)
      }
    )
  ] });
}
function ModelEditor(props) {
  const current = (0, import_react.useMemo)(
    () => props.table && typeof props.table === "object" ? Object.fromEntries(Object.entries(props.table).map(([k, v]) => [k, v ?? ""])) : {},
    [props.table]
  );
  const [draft, setDraft] = (0, import_react.useState)(() => ({ ...current }));
  const [state, setState] = (0, import_react.useState)("idle");
  const [problems, setProblems] = (0, import_react.useState)([]);
  const dirty = (0, import_react.useMemo)(() => {
    const keys = /* @__PURE__ */ new Set([...Object.keys(draft), ...Object.keys(current)]);
    for (const key of keys) if ((draft[key] ?? void 0) !== (current[key] ?? void 0)) return true;
    return false;
  }, [draft, current]);
  const toggle = (level, on) => {
    setState("idle");
    setProblems([]);
    setDraft((prev) => {
      const next = { ...prev };
      if (on) next[level] = level === "off" ? "" : next[level] ?? level;
      else delete next[level];
      return next;
    });
  };
  const setWire = (level, wire) => {
    setState("idle");
    setProblems([]);
    setDraft((prev) => ({ ...prev, [level]: wire }));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-model", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-model-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-model-id", title: props.provider + "/" + props.model, children: props.model }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "er-btn",
          "data-primary": dirty,
          disabled: !dirty || props.readonly,
          onClick: async () => {
            const local = validateEffortTable(normalizeEffortTable(draft));
            if (local.length > 0) {
              setProblems(local);
              setState("failed");
              return;
            }
            const result = await props.onSave(props.provider, props.model, draft);
            setProblems(result.problems ?? []);
            setState(result.ok ? "saved" : "failed");
          },
          children: props.t("card.custom.save")
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "er-efforts", children: EDITABLE_LEVELS.map((level) => {
      const checked = level in draft;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "er-effort", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked,
              disabled: props.readonly,
              onChange: (event) => toggle(level, event.currentTarget.checked)
            }
          ),
          " " + level
        ] }),
        checked && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "text",
            value: draft[level] ?? "",
            disabled: props.readonly,
            placeholder: level === "off" ? props.t("card.custom.offPlaceholder") : props.t("card.custom.wirePlaceholder"),
            onChange: (event) => setWire(level, event.currentTarget.value)
          }
        )
      ] }, level);
    }) }),
    state === "saved" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-note", "data-tone": "ok", children: props.t("card.custom.saved") }),
    state === "failed" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "er-note", "data-tone": "error", children: [
      props.t("card.custom.failed"),
      problems.length > 0 ? "\uFF1A" + problems.join("\uFF1B") : ""
    ] })
  ] });
}
function CustomModels(props) {
  const { piAiScope, t } = props;
  const snapshot = useScope(piAiScope);
  const [query, setQuery] = (0, import_react.useState)("");
  const [open, setOpen] = (0, import_react.useState)({});
  if (!snapshot || snapshot.status !== "ready") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.custom.unavailable") });
  }
  const providers = snapshot.value && snapshot.value.providers || {};
  const readonly = !snapshot.writable;
  const saveModel = async (provider, model, table) => {
    try {
      const { next, changed, problems } = withModelEfforts(snapshot.value, provider, model, table);
      if (!changed) return { ok: false, problems };
      await piAiScope.set("providers", next.providers);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  };
  const fillAll = async () => {
    const targets = fillCandidates(snapshot.value).filter((key) => {
      const provider = key.slice(0, key.indexOf("/"));
      return isCustomGateway(providers[provider]);
    });
    const { next, filled } = withDefaultEfforts(snapshot.value, { targets });
    if (next === snapshot.value || filled.length === 0) return;
    try {
      await piAiScope.set("providers", next.providers);
    } catch {
    }
  };
  const rows = [];
  for (const [provider, profile] of Object.entries(providers)) {
    const hasModels = Array.isArray(profile && profile.models) && profile.models.length > 0;
    const hasOverrides = profile && profile.modelOverrides && typeof profile.modelOverrides === "object" && Object.keys(profile.modelOverrides).length > 0;
    if (hasModels || hasOverrides) {
      rows.push({ provider, profile, custom: isCustomGateway(profile) });
    }
  }
  if (rows.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.custom.empty") });
  const needle = query.trim().toLowerCase();
  const match = (text) => !needle || text.toLowerCase().includes(needle);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        className: "er-search",
        type: "text",
        value: query,
        placeholder: t("card.custom.search"),
        onChange: (event) => setQuery(event.currentTarget.value)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "er-row", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: t("card.custom.hint") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {}),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "er-btn", disabled: readonly, onClick: fillAll, children: t("card.custom.fillAll") })
    ] }),
    rows.map(({ provider, profile, custom }) => {
      const models = [];
      if (Array.isArray(profile.models)) {
        for (const row of profile.models) {
          if (row && typeof row === "object" && typeof row.id === "string") {
            models.push({ id: row.id, table: row.reasoningEfforts });
          }
        }
      }
      if (profile.modelOverrides && typeof profile.modelOverrides === "object") {
        for (const [id, row] of Object.entries(profile.modelOverrides)) {
          models.push({ id, table: row && row.reasoningEfforts });
        }
      }
      const visible = models.filter((m) => match(m.id) || match(provider));
      if (visible.length === 0) return null;
      const expanded = open[provider] ?? needle.length > 0;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "details",
        {
          className: "er-provider",
          open: expanded,
          onToggle: (event) => setOpen((prev) => ({ ...prev, [provider]: event.target.open })),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [
              provider,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-tag", children: models.length + " " + t("card.custom.models") }),
              custom && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-tag", children: t("card.custom.customRoute") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "er-provider-body", children: visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "er-note", children: t("card.custom.none") }) : visible.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              ModelEditor,
              {
                provider,
                model: m.id,
                table: m.table,
                readonly,
                t,
                onSave: saveModel
              },
              m.id + "|" + JSON.stringify(m.table ?? null)
            )) })
          ]
        },
        provider
      );
    })
  ] });
}
function SettingsCard(props) {
  const { scope, piAiScope, t } = props;
  const snapshot = useScope(scope);
  if (!snapshot || snapshot.status !== "ready") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.custom.unavailable") });
  }
  const value = snapshot.value || {};
  const readonly = !snapshot.writable;
  const set = (path, next) => {
    scope.set(path, next).catch(() => {
    });
  };
  const routes = value.routes || {};
  const levelOptions = [
    { value: "auto", label: t("card.defaultLevel.auto") },
    ...["off", "on", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => ({ value: level, label: level }))
  ];
  const routeOptions = (allowed) => allowed.map((tier) => ({ value: tier, label: tier }));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.description") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      SwitchRow,
      {
        label: t("card.enabled"),
        checked: value.enabled !== false,
        disabled: readonly,
        onChange: (v) => set("enabled", v)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      SelectRow,
      {
        label: t("card.defaultLevel"),
        value: value.defaultLevel ?? "auto",
        options: levelOptions,
        disabled: readonly,
        onChange: (v) => set("defaultLevel", v)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      SelectRow,
      {
        label: t("card.subagentEffort"),
        value: value.subagentEffort ?? "inherit",
        options: [
          { value: "inherit", label: t("card.subagentInherit") },
          ...["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => ({ value: level, label: level }))
        ],
        disabled: readonly,
        onChange: (v) => set("subagentEffort", v)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("card.bounds") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SwitchRow,
        {
          label: t("card.allowMax"),
          checked: value.allowMax !== false,
          disabled: readonly,
          onChange: (v) => set("allowMax", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SelectRow,
        {
          label: t("card.maxFallback"),
          value: value.maxFallback ?? "high",
          options: routeOptions(["low", "high"]),
          disabled: readonly || value.allowMax === true,
          onChange: (v) => set("maxFallback", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SwitchRow,
        {
          label: t("card.wish"),
          checked: value.wish !== false,
          disabled: readonly,
          onChange: (v) => set("wish", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SwitchRow,
        {
          label: t("card.poisonRecovery"),
          checked: value.poisonRecovery !== false,
          disabled: readonly,
          onChange: (v) => set("poisonRecovery", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SwitchRow,
        {
          label: t("card.trajectoryAnnotate"),
          checked: value.trajectoryAnnotate !== false,
          disabled: readonly,
          onChange: (v) => set("trajectoryAnnotate", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SwitchRow,
        {
          label: t("card.frugalDemote"),
          checked: value.frugalDemote !== false,
          disabled: readonly,
          onChange: (v) => set("frugalDemote", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberRow,
        {
          label: t("card.contextPressure"),
          value: Number(value.contextPressure ?? 0.75),
          min: 0,
          max: 1,
          step: 0.05,
          disabled: readonly,
          onChange: (v) => set("contextPressure", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberRow,
        {
          label: t("card.sessionTokenBudget"),
          value: Number(value.sessionTokenBudget ?? 0),
          min: 0,
          step: 1e4,
          disabled: readonly,
          onChange: (v) => set("sessionTokenBudget", v)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("card.routes") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SelectRow,
        {
          label: t("card.route.trivial"),
          value: routes.trivial ?? "low",
          options: routeOptions(["low", "high"]),
          disabled: readonly,
          onChange: (v) => set("routes.trivial", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SelectRow,
        {
          label: t("card.route.standard"),
          value: routes.standard ?? "low",
          options: routeOptions(["low", "high"]),
          disabled: readonly,
          onChange: (v) => set("routes.standard", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SelectRow,
        {
          label: t("card.route.engineering"),
          value: routes.engineering ?? "high",
          options: routeOptions(["low", "high", "max"]),
          disabled: readonly,
          onChange: (v) => set("routes.engineering", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SelectRow,
        {
          label: t("card.route.hard"),
          value: routes.hard ?? "max",
          options: routeOptions(["high", "max"]),
          disabled: readonly,
          onChange: (v) => set("routes.hard", v)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "er-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("card.advanced") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberRow,
        {
          label: t("card.downAfter"),
          value: Number(value.downAfter ?? 2),
          min: 1,
          max: 5,
          disabled: readonly,
          onChange: (v) => set("downAfter", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberRow,
        {
          label: t("card.escalateOnErrors"),
          value: Number(value.escalateOnErrors ?? 1),
          min: 1,
          max: 10,
          disabled: readonly,
          onChange: (v) => set("escalateOnErrors", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberRow,
        {
          label: t("card.escalateOnRepeats"),
          value: Number(value.escalateOnRepeats ?? 3),
          min: 2,
          max: 10,
          disabled: readonly,
          onChange: (v) => set("escalateOnRepeats", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        NumberRow,
        {
          label: t("card.maxEscalations"),
          value: Number(value.maxEscalations ?? 2),
          min: 1,
          max: 3,
          disabled: readonly,
          onChange: (v) => set("maxEscalations", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.cues.hint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        CuesRow,
        {
          label: t("card.cues.strong"),
          value: String(value.cuesStrong ?? ""),
          disabled: readonly,
          onChange: (v) => set("cuesStrong", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        CuesRow,
        {
          label: t("card.cues.normal"),
          value: String(value.cuesNormal ?? ""),
          disabled: readonly,
          onChange: (v) => set("cuesNormal", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        CuesRow,
        {
          label: t("card.cues.cheap"),
          value: String(value.cuesCheap ?? ""),
          disabled: readonly,
          onChange: (v) => set("cuesCheap", v)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        CuesRow,
        {
          label: t("card.cues.wish"),
          value: String(value.cuesWish ?? ""),
          disabled: readonly,
          onChange: (v) => set("cuesWish", v)
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "er-group", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("card.custom") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SwitchRow,
        {
          label: t("card.fillCustomModels"),
          checked: value.fillCustomModels !== false,
          disabled: readonly,
          onChange: (v) => set("fillCustomModels", v)
        }
      ),
      piAiScope ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CustomModels, { piAiScope, t }) : null
    ] }),
    readonly && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("card.readonly") })
  ] });
}

// src/client/Badge.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var POLL_MS = 2500;
function Badge(props) {
  const { sessionId, t } = props;
  const [state, setState] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
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
  if (!state || state.ok !== true || state.enabled !== true) return null;
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "er-badge", "data-on": "true", title: tooltip, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "er-badge-dot" }),
    label
  ] });
}

// src/client/trajectory.ts
var POLL_MS2 = 2500;
var FULL_SWEEP_EVERY = 8;
var CAPTION_ATTR = "data-er-trj";
var DONE_ATTR = "data-er-trj-done";
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
  const mountCaption = (tr, caption) => {
    const cell = tr.querySelector("td:last-child");
    const target = (cell && cell.firstElementChild) ?? cell ?? tr;
    target.insertAdjacentElement("afterbegin", caption);
  };
  const decorateRow = (tr) => {
    const isAssistantRow = (tr.getAttribute("data-kind") || "") === "message";
    const anchorId = isAssistantRow ? anchorIdOf(tr) : null;
    const anchor = anchorId !== null && anchors.enabled ? anchors.anchors[anchorId] : void 0;
    const label = anchor ? labelOf(anchor) : "";
    if (tr.getAttribute(DONE_ATTR) !== label) {
      tr.setAttribute(DONE_ATTR, label);
      let caption = captions.get(tr);
      if (!label) {
        if (caption) {
          caption.remove();
          captions.delete(tr);
        }
      } else {
        if (!caption) {
          caption = document.createElement("span");
          caption.setAttribute(CAPTION_ATTR, "");
          caption.setAttribute("class", "er-trj");
          captions.set(tr, caption);
          mountCaption(tr, caption);
        }
        caption.setAttribute("title", label);
        if (caption.textContent !== label) caption.textContent = label;
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
    sessionId = currentSessionId();
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
    for (const mutation of mutations) {
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
    observer.observe(document.body, { childList: true, subtree: true });
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
  ctx.inject(["configForms"], (scope) => {
    scope.slots.inject("settings.section", () => scope.slots.register({
      name: "settings.section",
      id: "effort-router",
      order: 40,
      label: () => t("section.title"),
      locale: NS,
      inject: () => ({
        scope: ctx.configForms.get("effort-router"),
        piAiScope: ctx.configForms.get("llm-pi-ai"),
        t
      })
    }, SettingsCard));
  });
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
