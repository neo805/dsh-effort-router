/**
 * dsh-effort-router client dictionaries. zh is the key-set source of truth.
 * Badge keys plus the one caption fallback: the settings card (and its card.*
 * keys) was removed in 0.2.7-rc.6 — every user-facing option lives in the
 * plugin config file — while `annotation.default` still labels the optional
 * chat caption for a step with no stamped effort (chatAnnotate).
 */
export const NS = 'effort-router'

export const zh = {
  'badge.auto': 'Auto',
  'badge.manual': '手动',
  'badge.default': '默认',
  'badge.subagent': '子代理',
  'badge.poisoned': '思考关闭',
  'badge.poisonedUnsupported': '无法保持思考关闭',
  'badge.unsupported': '不支持',
  'badge.none': '本会话暂无调度记录',
  'annotation.default': '默认',
}

export const en = {
  'badge.auto': 'Auto',
  'badge.manual': 'Manual',
  'badge.default': 'Default',
  'badge.subagent': 'Subagent',
  'badge.poisoned': 'Thinking off',
  'badge.poisonedUnsupported': 'Off unavailable',
  'badge.unsupported': 'Unsupported',
  'badge.none': 'No routing decision in this session yet',
  'annotation.default': 'default',
}

export type LocaleKey = keyof typeof zh
