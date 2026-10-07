/**
 * Offline fill simulation against a realistic llm-pi-ai section: two
 * catalog-backed gateway routes (no explicit api/baseURL) whose hand-declared
 * models[] rows carry no reasoningEfforts — the 0.1.0 custom-gateway URL
 * heuristic filled NOTHING for such routes. The resolution gate must fill
 * exactly the models whose resolved info advertises no thinking levels, and
 * skip the ones that resolve with levels (catalog inheritance must never be
 * shadowed).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillCandidates, withDefaultEfforts } from '../lib/custom-models.js'
import { resolveFillTargets } from '../lib/index.js'

/** A realistic section shape (fictional provider/model ids). */
const productionSection = {
  providers: {
    'acme-token-plan': {
      apiKeyEnv: 'ACME_TOKEN_PLAN_API_KEY',
      models: [
        { id: 'acme-flash', name: 'Acme Flash', contextWindow: 983000, maxTokens: 64000 },
        { id: 'acme-max', name: 'Acme Max', contextWindow: 983000, maxTokens: 64000 },
        { id: 'vendor-flash', name: 'Acme Vendor Flash', contextWindow: 1000000, maxTokens: 64000 },
      ],
    },
    'globex-go': {
      apiKeyEnv: 'GLOBEX_GO_API_KEY',
      models: [
        { id: 'mini-3', name: 'Globex Mini 3', contextWindow: 1000000, maxTokens: 131072 },
        { id: 'vendor-v4-flash', name: 'Globex Vendor V4 Flash', contextWindow: 1000000, maxTokens: 384000 },
        { id: 'vendor-v4-pro', name: 'Globex Vendor V4 Pro', contextWindow: 1000000, maxTokens: 384000 },
        { id: 'thinker-k3', name: 'Globex Thinker K3', contextWindow: 1048576, maxTokens: 131072 },
        { id: 'chat-53-flash', name: 'Globex Chat 5.3 Flash', contextWindow: 1000000, maxTokens: 131072 },
      ],
    },
  },
}

test('all 8 catalog-route models are fill candidates (no tables declared)', () => {
  const candidates = fillCandidates(productionSection)
  assert.equal(candidates.length, 8)
  assert.ok(candidates.includes('globex-go/thinker-k3'))
  assert.ok(candidates.includes('acme-token-plan/vendor-flash'))
})

test('resolution gate: only models resolving with NO thinking levels are filled', async () => {
  // All models resolve bare, EXCEPT one that inherits a real table from its
  // catalog entry, and one whose resolution fails this round.
  const withLevels = new Set(['acme-token-plan/vendor-flash'])
  const llm = {
    async resolveModelInfo(provider, model) {
      if (provider === 'globex-go' && model === 'chat-53-flash') {
        throw new Error('route not ready') // resolution failure -> skip this round
      }
      if (withLevels.has(provider + '/' + model)) {
        return { reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } }
      }
      return { inputModalities: ['text'] } // no reasoning metadata
    },
  }
  const candidates = fillCandidates(productionSection)
  const targets = await resolveFillTargets(llm, candidates)
  assert.deepEqual([...targets].sort(), [
    'acme-token-plan/acme-flash',
    'acme-token-plan/acme-max',
    'globex-go/mini-3',
    'globex-go/thinker-k3',
    'globex-go/vendor-v4-flash',
    'globex-go/vendor-v4-pro',
  ])

  const { next, filled } = withDefaultEfforts(productionSection, { targets })
  assert.equal(filled.length, 6)
  const thinker = next.providers['globex-go'].models.find((m) => m.id === 'thinker-k3')
  assert.deepEqual(thinker.reasoningEfforts, { off: null, high: 'high', max: 'max' })
  // untouched: catalog-inheriting model, failed-resolution model, and the input itself
  const vendorFlash = next.providers['acme-token-plan'].models.find((m) => m.id === 'vendor-flash')
  assert.equal(vendorFlash.reasoningEfforts, undefined)
  const chat = next.providers['globex-go'].models.find((m) => m.id === 'chat-53-flash')
  assert.equal(chat.reasoningEfforts, undefined)
  assert.equal(productionSection.providers['globex-go'].models[3].reasoningEfforts, undefined)
})

test('idempotence: a second fill run over the filled section is a no-op', async () => {
  const llm = { async resolveModelInfo() { return {} } }
  const candidates = fillCandidates(productionSection)
  const targets = await resolveFillTargets(llm, candidates)
  const first = withDefaultEfforts(productionSection, { targets })
  // After the write, every row has a table: no candidates remain.
  assert.deepEqual(fillCandidates(first.next), [])
  const second = withDefaultEfforts(first.next, { targets: [] })
  assert.equal(second.next, first.next)
  assert.deepEqual(second.filled, [])
})
