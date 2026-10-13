/**
 * dsh-effort-router — client plugin.
 *
 * Two default surfaces plus one opt-in, no write path of its own:
 *   1. a read-only composer badge (conversation.input.right) showing the last
 *      scheduled effort of the session (config `showBadge` gates it);
 *   2. a DOM projection that hoists `provider/model · effort` onto the NATIVE
 *      trajectory ledger rows (the dsh-trajectory-zh route: assembly-layer
 *      load + MutationObserver; no host package is touched, no new view;
 *      config `trajectoryAnnotate` gates it);
 *   3. OPT-IN per-tool-call `provider/model · effort` caption rows in the
 *      conversation view (config `chatAnnotate`, default off).
 *
 * There is NO settings card by design (0.2.7-rc.6): every user-facing option
 * lives in the plugin config file (schema in lib/index.js), edited directly
 * or by an agent on the user's behalf — the GUI only ever displays state.
 * The chat flow stays clean BY DEFAULT: config `chatAnnotate` (default off)
 * opts into per-tool-call `provider/model · effort` caption rows (surface 3);
 * the client reads the flag once at load, so a toggle applies on reload.
 *
 * The per-session CONTROL stays in the native model selector: the host plugin
 * advertises an `auto` mask on every reasoning-capable model, so Auto vs a
 * concrete level is the entire interaction — this client adds no second one.
 */
import { NS, en, zh } from './locales'
import { ensureStyles } from './styles'
import { Badge } from './Badge'
import { startTrajectoryDecorator } from './trajectory'
import { ROUTE_KIND, RouteRow, routeRowDefinition } from './annotations'

/** Services every surface needs; feature services are optional-injected below. */
export const inject = ['slots', 'locale']

export function apply(ctx: any) {
  ensureStyles()
  const t: (key: string) => string = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'effort-router: dictionaries')

  // 1. Composer badge ----------------------------------------------------------
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'effort-router:badge',
    order: 30,
    locale: NS,
    inject: (sessionId: string) => ({ sessionId, t }),
  }, Badge))

  // 2. Native trajectory hoisting (DOM projection; no host package touched) ----
  ctx.effect(() => startTrajectoryDecorator(), 'effort-router: trajectory decorator')

  // 3. Chat captions (opt-in via config chatAnnotate, read once at load) -------
  ctx.effect(() => {
    let cancelled = false
    fetch('/effort-router/state', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (cancelled || !json || json.chatAnnotate !== true) return
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
      })
      .catch(() => { /* the route is best-effort; no flag, no captions */ })
    return () => { cancelled = true }
  }, 'effort-router: chat captions (chatAnnotate)')
}
