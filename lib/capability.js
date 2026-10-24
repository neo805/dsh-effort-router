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
 *      Cache misses are single-flight and cache writes are generation-guarded:
 *      a clear() (adapter churn) invalidates both the resolved entries and any
 *      older resolve still in flight, so stale capabilities cannot repopulate
 *      the cache after the host has changed routes.
 *
 *   2. advertiseAutoMask — wrap every registered adapter's resolveModel so the
 *      returned reasoning.efforts gain an { id: 'auto' } entry. The model
 *      selector then offers Auto alongside the adapter's native levels; the
 *      selection travels to this plugin's agent/request interceptor as
 *      seed.reasoningEffort === 'auto' and is resolved to a wire level BEFORE
 *      prepareCall validates the request. Idempotent per adapter; re-run on
 *      every `llm/adapters-updated` because adapters may register late.
 *
 *      The wrapper is an OWNED effect: advertiseAutoMask returns a disposer
 *      that restores each exact original function, but only while this
 *      wrapper is still the current one (a third-party wrapper registered
 *      later is never clobbered). Resolved info is copied rather than mutated:
 *      adapters may reuse the object as their own cache.
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
  const inFlight = new Map()
  let generation = 0

  return {
    async resolve(provider, model) {
      if (typeof provider !== 'string' || typeof model !== 'string') return UNRESOLVABLE_CAPABILITY
      const key = provider + CAPABILITY_CACHE_KEY_SEPARATOR + model
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const pending = inFlight.get(key)
      if (pending !== undefined) return pending

      // One read per provider/model, even under concurrent step admission.
      const ticket = generation
      const promise = (async () => {
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
        // Adapter churn happened while this read was in flight: the result is
        // stale by definition, so answer the original caller but never cache it.
        if (ticket === generation) cache.set(key, capability)
        return capability
      })()
      inFlight.set(key, promise)
      try {
        return await promise
      } finally {
        if (inFlight.get(key) === promise) inFlight.delete(key)
      }
    },
    clear() {
      generation += 1
      cache.clear()
      inFlight.clear()
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
 *
 * @returns {{ count: number, dispose: () => void }} registration owning every
 *          wrapper installed by this call. Disposing restores the exact
 *          original functions, but never overwrites a later wrapper.
 */
export function advertiseAutoMask(llm, logger) {
  const installs = []
  for (const registration of llm && llm.adapters && typeof llm.adapters.values === 'function'
    ? llm.adapters.values()
    : []) {
    const adapter = registration && registration.adapter
    if (!adapter || typeof adapter.resolveModel !== 'function') continue
    if (adapter[WRAPPED]) continue
    const original = adapter.resolveModel
    const bound = original.bind(adapter)
    const wrapper = async (provider, model, signal) => {
      const info = await bound(provider, model, signal)
      const reasoning = info && info.reasoning
      if (reasoning === undefined || reasoning === null) return info
      const efforts = Array.isArray(reasoning.efforts) ? [...reasoning.efforts] : []
      if (!efforts.some((effort) => effort && effort.id !== 'off' && effort.id !== 'none' && effort.id !== 'auto')) return info
      if (!efforts.some((effort) => effort && effort.id === 'auto')) efforts.push(AUTO_EFFORT)
      // Copy both objects: adapters may cache and share `info` across callers.
      return { ...info, reasoning: { ...reasoning, efforts } }
    }
    adapter.resolveModel = wrapper
    Object.defineProperty(adapter, WRAPPED, { value: wrapper, configurable: true })
    installs.push({ adapter, original, wrapper })
  }
  if (installs.length > 0 && logger && typeof logger.info === 'function') {
    logger.info('[effort-router] auto mask advertised on ' + installs.length + ' adapter(s)')
  }
  let disposed = false
  return {
    count: installs.length,
    dispose() {
      if (disposed) return
      disposed = true
      for (let i = installs.length - 1; i >= 0; i -= 1) {
        const { adapter, original, wrapper } = installs[i]
        if (adapter.resolveModel !== wrapper) continue
        adapter.resolveModel = original
        delete adapter[WRAPPED]
      }
    },
  }
}