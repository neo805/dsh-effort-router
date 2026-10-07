/**
 * dsh-effort-router — client plugin.
 *
 * Three surfaces, no write path of its own beyond the settings scopes:
 *   1. a settings.section card (global scheduler config + the llm-pi-ai
 *      custom-model effort editor) bound through configForms;
 *   2. a read-only composer badge (conversation.input.right) showing the last
 *      scheduled effort of the session;
 *   3. per-tool-call effort captions (conversation.chat.node) folded from the
 *      host's effortRouterRoute session projection.
 *
 * The per-session CONTROL stays in the native model selector: the host plugin
 * advertises an `auto` mask on every reasoning-capable model, so Auto vs a
 * concrete level is the entire interaction — this client adds no second one.
 */
import { NS, en, zh } from './locales'
import { ensureStyles } from './styles'
import { SettingsCard } from './SettingsCard'
import { Badge } from './Badge'
import { ROUTE_KIND, RouteRow, routeRowDefinition } from './annotations'

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

  // 3. Chat annotations --------------------------------------------------------
  ctx.inject(['uiConversation'], (scope: any) => {
    const conversation = scope.uiConversation
    if (conversation && conversation.events && typeof conversation.events.register === 'function') {
      conversation.events.register(routeRowDefinition)
    }
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({
      name: 'conversation.chat.node',
      key: ROUTE_KIND,
      locale: NS,
      inject: () => ({ t }),
    }, RouteRow))
  })
}
