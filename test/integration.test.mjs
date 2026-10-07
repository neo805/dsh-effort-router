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
  const settings = {
    get: (ns) => (ns === 'llm-pi-ai' ? section : undefined),
    update: async (ns, patch) => { writes.push({ ns, patch }) },
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
  const providers = writes[0].patch.providers
  const lite = providers['acme-gateway'].models.find((m) => m.id === 'think-lite')
  assert.deepEqual(lite.reasoningEfforts, { off: '', high: 'high', max: 'max' })
  const pro = providers['acme-gateway'].models.find((m) => m.id === 'think-pro')
  assert.deepEqual(pro.reasoningEfforts, { off: '', high: 'high', max: 'max' })
  // the catalog-blessed model was never touched
  assert.equal(providers['catalog-blessed'].models[0].reasoningEfforts, undefined)

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

  // A cheap brief on the filled model: the table is off/high/max, so the
  // scheduled low maps to the nearest advertised level, ties resolving to the
  // STRONGER one — high (thinking stays on; off would poison tool loops).
  const cheap = {
    sessionId: 's-e2e-2',
    session: { id: 's-e2e-2', header: {}, deriveMessages: () => [] },
  }
  onClaimed({ agent: cheap, message: { content: '翻译这句话', role: 'user' }, turn: 1 })
  const cheapOut = await onRequest({ agent: cheap, turn: 1, step: 1 }, async () => ({
    provider: 'acme-gateway', model: 'think-lite', reasoningEffort: 'auto',
  }))
  assert.equal(cheapOut.reasoningEffort, 'high', 'low tier clamps up to high on an off/high/max table')

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
