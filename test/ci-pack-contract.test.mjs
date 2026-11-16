import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8')

test('CI release gate inspects the packed artifact, not only working-tree paths', () => {
  assert.match(workflow, /\bpnpm\s+pack\b/, 'the release job must create the real npm tarball')
  assert.match(workflow, /\btar\s+(?:-[^\n]*z[^\n]*f|--list)\b/, 'the release job must enumerate the tarball contents')
  assert.match(workflow, /lib\/index\.js/)
  assert.match(workflow, /lib\/client\.js/)
  assert.match(workflow, /cordis\.patch\.yml/)
  assert.match(workflow, /THIRD_PARTY_NOTICES\.md/)
})

test('CI keeps the supported runtime matrix and bundle drift gate', () => {
  assert.match(workflow, /node:\s*\[['"]22\.19\.0['"],\s*['"]24(?:\.0\.0|\.x)['"]\]/)
  assert.match(workflow, /os:\s*\[ubuntu-latest,\s*windows-latest\]/)
  assert.match(workflow, /git diff --exit-code -- lib\/client\.js/)
  assert.match(workflow, /timeout-minutes:\s*15/)
})
