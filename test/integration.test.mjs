/**
 * End-to-end offline proof:
 *
 *   apply() with a mock host
 *   → startup fill writes reasoningEfforts for a bare custom model (mock llm
 *     resolves it without reasoning metadata)
 *   → the SAME mock then resolves that model WITH the filled table
 *   → an auto request for it is scheduled to a concrete level
 *   → a manual pick passes through verbatim
 *   → a model that resolved WITH catalog levels is never filled
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as entry from '../lib/index.js'

function makeHost() {
  const listeners = new Map()
  const section = {
    providers: {
      'acme-gateway': { apiKeyEnv: 'KEY', models: [{ id: 'think-lite' }, { id: 'think-pro' }] },
      'catalog-blessed': { apiKeyEnv: 'KEY2', models: [{ id: 'thinking-model' }] },
    },
  }
  const writes = []
  // Mirror the REAL 0.2.1 @deepseek-ai/dsh-settings seam: describe() returns
  // volatile field projections keyed by ns (with a revision) and the LAYER
  // split — base (profile/bundle config), user (settings-document edits),
  // value (effective). The fill reads candidates from base, writes into the
  // user layer, and never touches a row the user layer owns.
  // There is NO get(ns) — 0.1.0–0.1.2 guarded on one, so the fill silently
  // never ran.
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', base: section, user: {}, value: section, revision: 7 }],
    update: async (ns, patch, expectedRevision) => { writes.push({ ns, patch, expectedRevision }) },
  }
  const llm = {
    adapters: new Map(),
    async resolveModelInfo(provider, model) {
      // The catalog-blessed model always advertises levels (inherited).
      if (provider === 'catalog-blessed') {
        return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } }
      }
      // acme-gateway models advertise levels only after the fill write landed.
      const row = writes.length
        ? writes.at(-1).patch.providers?.[provider]?.models?.find((m) => m.id === model)
        : undefined
      const table = row && row.reasoningEfforts
      if (table) return { reasoning: { efforts: Object.keys(table).map((id) => ({ id })) } }
      return { inputModalities: ['text'] }
    },
  }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    get(name) {
      if (name === 'llm') return llm
      if (name === 'settings') return settings
      throw new Error('no service ' + name)
    },
    on(event, handler) { listeners.set(event, handler); return () => {} },
    inject() { return () => {} },
  }
  return { ctx, listeners, writes, section }
}

test('fill → capability refresh → auto schedules the previously-bare custom model', async () => {
  const { ctx, listeners, writes } = makeHost()
  entry.apply(ctx, entry.Config({}))
  // Let the queued fill chain settle.
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(writes.length, 1, 'exactly one settings write')
  assert.equal(writes[0].expectedRevision, 7, 'the write is conflict-guarded by the describe() revision')
  const providers = writes[0].patch.providers
  const lite = providers['acme-gateway'].models.find((m) => m.id === 'think-lite')
  assert.deepEqual(lite.reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
  const pro = providers['acme-gateway'].models.find((m) => m.id === 'think-pro')
  assert.deepEqual(pro.reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
  // the catalog-blessed provider is not in the write at all: the fill only
  // carries the providers it touched (settings.update merges the patch).
  assert.equal(providers['catalog-blessed'], undefined)

  // Now the interceptor schedules think-lite (auto mask from the selector).
  const onRequest = listeners.get('agent/request')
  const onClaimed = listeners.get('agent/inbox/claimed')
  const agent = {
    sessionId: 's-e2e',
    session: { id: 's-e2e', header: {}, deriveMessages: () => [] },
  }
  onClaimed({ agent, message: { content: '帮我重构这个模块的缓存层', role: 'user' }, turn: 1 })
  const autoOut = await onRequest({ agent, turn: 1, step: 1 }, async () => ({
    provider: 'acme-gateway', model: 'think-lite', reasoningEffort: 'auto',
  }))
  assert.equal(autoOut.reasoningEffort, 'high', 'engineering brief -> high')

  // Manual pick passes through verbatim.
  const manualOut = await onRequest({ agent, turn: 1, step: 2 }, async () => ({
    provider: 'acme-gateway', model: 'think-lite', reasoningEffort: 'max',
  }))
  assert.equal(manualOut.reasoningEffort, 'max')

  // A cheap brief on the filled model: the 0.2.0 table is low/high/max, so
  // the scheduled low tier hits the advertised low exactly (no off rung in
  // the table means thinking can never be switched off on filled models).
  const cheap = {
    sessionId: 's-e2e-2',
    session: { id: 's-e2e-2', header: {}, deriveMessages: () => [] },
  }
  onClaimed({ agent: cheap, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  const cheapOut = await onRequest({ agent: cheap, turn: 1, step: 1 }, async () => ({
    provider: 'acme-gateway', model: 'think-lite', reasoningEffort: 'auto',
  }))
  assert.equal(cheapOut.reasoningEffort, 'low', 'low tier hits the advertised low on a low/high/max table')

  // On a model that DOES advertise low, the same cheap brief schedules low.
  const cheap2 = {
    sessionId: 's-e2e-3',
    session: { id: 's-e2e-3', header: {}, deriveMessages: () => [] },
  }
  onClaimed({ agent: cheap2, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  const cheap2Out = await onRequest({ agent: cheap2, turn: 1, step: 1 }, async () => ({
    provider: 'catalog-blessed', model: 'thinking-model', reasoningEffort: 'auto',
  }))
  assert.equal(cheap2Out.reasoningEffort, 'low')
})

test('dictStrong full replacement reaches the scheduler through apply()', async () => {
  const { ctx, listeners } = makeHost()
  entry.apply(ctx, entry.Config({ dictStrong: 'myowncue' }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const onRequest = listeners.get('agent/request')
  const onClaimed = listeners.get('agent/inbox/claimed')
  const mk = (id) => ({ sessionId: id, session: { id, header: {}, deriveMessages: () => [] } })

  // The shipped strong cue 重构 no longer counts: the replacement IS the
  // whole dictionary, so the same brief drops to standard -> low.
  const replaced = mk('s-dict-1')
  onClaimed({ agent: replaced, message: { content: '重构这个模块', role: 'user' }, turn: 1 })
  const outReplaced = await onRequest({ agent: replaced, turn: 1, step: 1 }, async () => ({
    provider: 'catalog-blessed', model: 'thinking-model', reasoningEffort: 'auto',
  }))
  assert.equal(outReplaced.reasoningEffort, 'low', 'full replacement drops shipped cues (deletion works)')

  // The replacement cue classifies engineering -> high.
  const own = mk('s-dict-2')
  onClaimed({ agent: own, message: { content: 'myowncue 这个模块', role: 'user' }, turn: 1 })
  const outOwn = await onRequest({ agent: own, turn: 1, step: 1 }, async () => ({
    provider: 'catalog-blessed', model: 'thinking-model', reasoningEffort: 'auto',
  }))
  assert.equal(outOwn.reasoningEffort, 'high', 'replacement cue drives engineering -> high')
})
