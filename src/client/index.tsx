/**
 * dsh-effort-router — client plugin.
 *
 * Two surfaces, no write path of its own:
 *   1. a read-only composer badge (conversation.input.right) showing the last
 *      scheduled effort of the session (config `showBadge` gates it);
 *   2. a DOM projection that hoists `provider/model · effort` onto the NATIVE
 *      trajectory ledger rows (the dsh-trajectory-zh route: assembly-layer
 *      load + MutationObserver; no host package is touched, no new view;
 *      config `trajectoryAnnotate` gates it).
 *
 * There is NO settings card by design (0.2.7-rc.6): every user-facing option
 * lives in the plugin config file (schema in lib/index.js), edited directly
 * or by an agent on the user's behalf — the GUI only ever displays state.
 * The chat flow stays clean on purpose (0.2.x review): no chat-flow
 * annotations.
 *
 * The per-session CONTROL stays in the native model selector: the host plugin
 * advertises an `auto` mask on every reasoning-capable model, so Auto vs a
 * concrete level is the entire interaction — this client adds no second one.
 */
import { NS, en, zh } from './locales'
import { ensureStyles } from './styles'
import { Badge } from './Badge'
import { startTrajectoryDecorator } from './trajectory'

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
}
