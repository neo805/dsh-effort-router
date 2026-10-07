/**
 * dsh-effort-router — client bundle build.
 *
 * esbuild bundles src/client/index.tsx (TSX, react + react/jsx-runtime
 * external) to CJS, then we wrap it in the DSH ModuleLoader factory envelope:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * The wrapper supplies `module`/`exports`; the bundle's `require("react")`
 * calls resolve against the host's PLATFORM_MODULES baseline at runtime.
 */
import { build } from 'esbuild'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const temp = join(root, 'lib', '.client.bundle.cjs')
const out = join(root, 'lib', 'client.js')

await build({
  entryPoints: [join(root, 'src', 'client', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outfile: temp,
  logLevel: 'warning',
})

const bundle = readFileSync(temp, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-effort-router",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${bundle}
\t\treturn module.exports;
\t},
});
`
writeFileSync(out, wrapped)
rmSync(temp, { force: true })
console.log('built lib/client.js (' + wrapped.length + ' bytes)')
