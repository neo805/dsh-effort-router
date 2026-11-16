import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name) => readFileSync(fileURLToPath(new URL('../' + name, import.meta.url)), 'utf8')
const collaboration = read('docs/COLLABORATION.md')
const pkg = JSON.parse(read('package.json'))
const policyMatch = collaboration.match(/下一施工版本从 `(\d+\.\d+\.\d+-agent\.\d+)` 开始/)
const nextVersion = policyMatch ? policyMatch[1] : '0.2.18-agent.2'
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('package version follows the next construction version declared in COLLABORATION.md', () => {
  assert.ok(policyMatch, 'docs/COLLABORATION.md must declare the next X.X.X-agent.X construction version')
  assert.equal(nextVersion, '0.2.18-agent.2')
  assert.equal(pkg.version, nextVersion)
})

test('both README first screens identify the same agent version', () => {
  for (const name of ['README.md', 'README.zh.md']) {
    const firstScreen = read(name).split(/\r?\n/).slice(0, 12).join('\n')
    assert.equal(new RegExp('`' + escapeRegExp(nextVersion) + '`').test(firstScreen), true,
      name + ' first screen must show the next construction version')
  }
})

test('CHANGELOG adds the agent release without rewriting the final rc history', () => {
  const changelog = read('CHANGELOG.md')
  assert.equal(new RegExp('^## \\[' + escapeRegExp(nextVersion) + '\\]', 'm').test(changelog), true,
    'CHANGELOG.md must add the next agent release')
  assert.equal(/^## \[0\.2\.17-rc\.1\]/m.test(changelog), true,
    '0.2.17-rc.1 is historical evidence and must remain')
})

test('DSH host engine and peer ranges keep their independent rc contract', () => {
  const hostRange = '>=0.2.0-rc.1 <0.2.3-0'
  assert.equal(pkg.engines.dsh, hostRange)
  assert.ok(Object.keys(pkg.peerDependencies).length > 0)
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    assert.equal(range, hostRange, name + ' must not inherit the plugin agent suffix policy')
  }
})
