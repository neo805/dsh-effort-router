/**
 * Host-runtime contract gate (F-01).
 *
 * The 0.2.2 agent loop captures the step's fixed model selection BEFORE
 * `agent/pre-step` and rejects an `agent/request` handler that returns a
 * different reasoningEffort ("...after step preparation fixed ...; use
 * agent.model.select() before step preparation."). The 0.2.1 loop has no such
 * capture, so a plugin that keeps rewriting effort in `agent/request` is
 * correct there and broken here. The contract must therefore be selected per
 * runtime, through the public `@deepseek-ai/dsh-app-boot`
 * `getDshRuntimeVersion()` API — never by sniffing private ctx services.
 *
 * IMPORTANT: the range in package.json is an INSTALL envelope, not a runtime
 * certification. A wide range says "which hosts may install this"; it says
 * nothing about which loop contract a given build has. Every accepted version
 * is individually contract-verified (executable fixture + real-host probe).
 * An unverified build fails loudly instead of silently falling back to the
 * 0.2.1 rewrite path, which 0.2.2 rejects at request time.
 */

/**
 * version -> agent-loop contract. Add a version only together with evidence:
 * a probe of the real package (claim/pre-step/request/step-end semantics) or
 * the executable fixture for that exact build.
 */
export const RUNTIME_CONTRACTS = Object.freeze({
  '0.2.1-rc.2': 'legacy',
  '0.2.1-rc.5': 'legacy',
  // Contract verified by test/helpers/host-0.2.2-harness.mjs: claimed is
  // synchronous, the selection is captured before pre-step, request results
  // are compared against that capture, and step/end + turn/end are emitted
  // from finally blocks.
  '0.2.2-alpha.2': 'modern',
  // Real-host probe of @deepseek-ai/dsh-agent-loop 0.2.2-rc.3 (transcript kept
  // with the maintainer notes, not shipped): claim emits `agent/inbox/claimed`
  // synchronously before `this.model.current()`, `agent/pre-step` may reject,
  // `agent/request` is compared against the fixed selection, and step/end +
  // turn/end are appended from finally blocks. One caveat: a session cannot
  // append while another append is publishing, so a step/end listener cannot
  // select synchronously — turn-auto retries that write on the next tick.
  '0.2.2-rc.3': 'modern',
})

/** Contracts that only the 0.2.2 loop has; documented for readers/tests. */
export const MODERN_CONTRACT = 'modern'

const verifiedList = () => Object.keys(RUNTIME_CONTRACTS).join(', ')

function unverifiedRuntime(version) {
  const error = new Error(
    '[effort-router] unsupported DSH runtime ' + JSON.stringify(version)
    + ': this build is contract-verified against ' + verifiedList()
    + '. An unverified host must not be guessed at: 0.2.1 needs the agent/request'
    + ' rewrite, 0.2.2 rejects it. Refusing to load.',
  )
  error.code = 'EFFORT_ROUTER_UNSUPPORTED_RUNTIME'
  return error
}

/**
 * Map a host runtime version to its agent-loop contract.
 * Throws for anything unverified — including empty or malformed versions.
 */
export function runtimeContractOf(version) {
  if (typeof version !== 'string' || version === '') throw unverifiedRuntime(version)
  const contract = Object.prototype.hasOwnProperty.call(RUNTIME_CONTRACTS, version)
    ? RUNTIME_CONTRACTS[version]
    : undefined
  if (!contract) throw unverifiedRuntime(version)
  return contract
}

// The public app-boot package is the only supported source of the runtime
// version. It does not exist on 0.2.1 hosts: an absent module means "legacy
// loop" (that host predates the runtime API, so there is nothing to verify
// against). Every other failure is rethrown by the caller.
let bootModule = null
let bootUnavailable = false
try {
  bootModule = await import('@deepseek-ai/dsh-app-boot')
} catch (_absent) {
  bootUnavailable = true
}

/**
 * Detect the agent-loop contract of the host this plugin is applying into.
 * @returns {'legacy'|'modern'}
 */
export function detectRuntimeContract() {
  if (bootUnavailable || !bootModule) return 'legacy'
  if (typeof bootModule.getDshRuntimeVersion !== 'function') {
    throw unverifiedRuntime(undefined)
  }
  return runtimeContractOf(bootModule.getDshRuntimeVersion())
}
