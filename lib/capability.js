/**
 * dsh-effort-router — model capability layer (import-free; services injected).
 *
 * Two jobs, both adapted from dsh-thinking-levels 4.0.2/4.1.0 (MIT,
 * Copyright drscrewdriver):
 *
 *   1. capabilityResolver — per-model reasoning metadata lookup with a cache:
 *      whether the model advertises efforts at all (the injection guard: a
 *      model without reasoning metadata must NEVER receive reasoningEffort, or
 *      dsh rejects the request with UNSUPPORTED_REASONING_EFFORT), the exact
 *      advertised id list (mapEffort's target vocabulary).
 *
 *   2. advertiseAutoMask — wrap every registered adapter's resolveModel so the
 *      returned reasoning.efforts gain an { id: 'auto' } entry. The model
 *      selector then offers Auto alongside the adapter's native levels; the
 *      selection travels to this plugin's agent/request interceptor as
 *      seed.reasoningEffort === 'auto' and is resolved to a wire level BEFORE
 *      prepareCall validates the request. Idempotent per adapter; re-run on
 *      every `llm/adapters-updated` because adapters may register late.
 */

/** The user-facing scheduler sentinel. Never sent to the API. */
export const AUTO_EFFORT = Object.freeze({ id: 'auto', name: 'Auto' })

/** A model that cannot be resolved is treated as non-reasoning: never inject. */
export const UNRESOLVABLE_CAPABILITY = Object.freeze({
  supportsReasoning: false,
  efforts: Object.freeze([]),
})

/** Whether a resolved model's reasoning metadata advertises at least one level. */
export function reasoningEffortSupported(reasoning) {
  if (typeof reasoning !== 'object' || reasoning === null) return false
  const efforts = reasoning.efforts
  return Array.isArray(efforts) && efforts.length > 0
}

const CAPABILITY_CACHE_KEY_SEPARATOR = '\0'

/**
 * Runtime model-capability lookup with a per-model cache.
 * @param opts.llm  () => the live llm service or undefined (late registration)
 */
export function createCapabilityResolver(opts) {
  const llmOf = opts && typeof opts.llm === 'function' ? opts.llm : () => undefined
  const cache = new Map()
  return {
    async resolve(provider, model) {
      if (typeof provider !== 'string' || typeof model !== 'string') return UNRESOLVABLE_CAPABILITY
      const key = provider + CAPABILITY_CACHE_KEY_SEPARATOR + model
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const llm = llmOf()
      let capability = UNRESOLVABLE_CAPABILITY
      try {
        const info = llm && typeof llm.resolveModelInfo === 'function'
          ? await llm.resolveModelInfo(provider, model)
          : undefined
        const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts)
          ? info.reasoning.efforts.map((effort) => effort && effort.id).filter((id) => typeof id === 'string')
          : []
        capability = {
          supportsReasoning: reasoningEffortSupported(info && info.reasoning),
          efforts,
        }
      } catch {
        capability = UNRESOLVABLE_CAPABILITY
      }
      cache.set(key, capability)
      return capability
    },
    clear() {
      cache.clear()
    },
  }
}

const WRAPPED = Symbol('effort-router:resolveModel-wrapped')

/**
 * Wrap every adapter's resolveModel so reasoning-capable models advertise the
 * `auto` mask. Idempotent: a wrapped adapter carries a marker and is skipped.
 *
 * Only models that already advertise at least one THINKING level (something
 * besides off/auto) gain the mask — a pure off list has nothing to schedule.
 */
export function advertiseAutoMask(llm, logger) {
  let wrapped = 0
  for (const registration of llm && llm.adapters && typeof llm.adapters.values === 'function'
    ? llm.adapters.values()
    : []) {
    const adapter = registration && registration.adapter
    if (!adapter || typeof adapter.resolveModel !== 'function' || adapter[WRAPPED]) continue
    const original = adapter.resolveModel.bind(adapter)
    adapter.resolveModel = async (provider, model, signal) => {
      const info = await original(provider, model, signal)
      const reasoning = info && info.reasoning
      if (reasoning === undefined || reasoning === null) return info
      const efforts = Array.isArray(reasoning.efforts) ? [...reasoning.efforts] : []
      if (!efforts.some((effort) => effort && effort.id !== 'off' && effort.id !== 'auto')) return info
      if (!efforts.some((effort) => effort && effort.id === 'auto')) efforts.push(AUTO_EFFORT)
      info.reasoning = { ...reasoning, efforts }
      return info
    }
    Object.defineProperty(adapter, WRAPPED, { value: original, configurable: true })
    wrapped += 1
  }
  if (wrapped > 0 && logger && typeof logger.info === 'function') {
    logger.info('[effort-router] auto mask advertised on ' + wrapped + ' adapter(s)')
  }
  return wrapped
}
