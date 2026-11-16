/**
 * Test-only module guard: model a development tree in which the optional host
 * peer `@deepseek-ai/dsh-app-boot` is not installed.
 *
 * Why: `lib/runtime.js` must refuse an unverified real host version, so a bare
 * `import('@deepseek-ai/dsh-app-boot')` that happens to resolve to whatever
 * pnpm auto-installed (for example 0.2.0-rc.2) is *not* the "no host" case the
 * legacy fixtures describe. Peer auto-installation is a property of the local
 * node_modules, never of the plugin build, so the test suite has to pin the
 * environment instead of inheriting it.
 *
 * Contract tests that need a host module (`loadApplyForRuntime`,
 * `loadRuntimeWithAppBoot`) register their own resolve hook later; those hooks
 * run first and short-circuit the specifier, so this guard only sees imports
 * that no test has claimed.
 */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-app-boot') {
      const error = new Error("Cannot find package '@deepseek-ai/dsh-app-boot'")
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    }
    return nextResolve(specifier, context)
  },
})
