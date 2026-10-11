/**
 * dsh-effort-router — client plugin.
 *
 * Two surfaces plus one DOM projection, no write path of its own beyond the
 * settings scopes:
 *   1. a settings.section card (global scheduler config + the llm-pi-ai
 *      custom-model effort editor) bound through configForms;
 *   2. a read-only composer badge (conversation.input.right) showing the last
 *      scheduled effort of the session;
 *   3. a DOM projection that hoists `provider/model · effort` onto the NATIVE
 *      trajectory ledger rows (the dsh-trajectory-zh route: assembly-layer
 *      load + MutationObserver; no host package is touched, no new view).
 *
 * The chat flow stays clean on purpose (0.2.x review): no chat-flow
 * annotations.
 *
 * The per-session CONTROL stays in the native model selector: the host plugin
 * advertises an `auto` mask on every reasoning-capable model, so Auto vs a
 * concrete level is the entire interaction — this client adds no second one.
 */
import { NS, en, zh } from './locales'
import { ensureStyles } from './styles'
import { SettingsCard } from './SettingsCard'
import { Badge } from './Badge'
import { startTrajectoryDecorator } from './trajectory'

/** Services every surface needs; feature services are optional-injected below. */
export const inject = ['slots', 'locale']

export function apply(ctx: any) {
  ensureStyles()
  const t: (key: string) => string = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'effort-router: dictionaries')

  // 1. Settings card ----------------------------------------------------------
  ctx.inject(['configForms'], (scope: any) => {
    scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section',
      id: 'effort-router',
      order: 40,
      label: () => t('section.title'),
      locale: NS,
      inject: () => ({
        scope: ctx.configForms.get('effort-router'),
        piAiScope: ctx.configForms.get('llm-pi-ai'),
        t,
      }),
    }, SettingsCard))
  })

  // 2. Composer badge ----------------------------------------------------------
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'effort-router:badge',
    order: 30,
    locale: NS,
    inject: (sessionId: string) => ({ sessionId, t }),
  }, Badge))

  // 3. Native trajectory hoisting (DOM projection; no host package touched) ----
  ctx.effect(() => startTrajectoryDecorator(), 'effort-router: trajectory decorator')
}
