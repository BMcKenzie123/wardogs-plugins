import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';

interface Options {
  delayMs: number;
  message: string;
  /** Text for a player the host has seen before (needs rememberPlayers). Empty = the same message. */
  returningMessage: string;
  rememberPlayers: boolean;
  /** false = a player the host has seen before gets no welcome at all; only first-ever visitors do. */
  greetReturning: boolean;
}

/** Sends a welcome DM a few seconds after a join. With greetReturning off, only newcomers hear from it. */
export default definePlugin<Options>({
  name: 'welcome',
  description: 'Sends a welcome DM',
  defaults: {
    delayMs: 6000,
    message: 'Welcome, {name}!',
    returningMessage: '',
    rememberPlayers: true,
    greetReturning: true,
  },
  setup(ctx) {
    const timers = new Set<NodeJS.Timeout>();
    ctx.onStop(() => {
      for (const t of timers) clearTimeout(t);
    });
    ctx.on('player.join', ({ player, snapshot }) => {
      const seen = ctx.state.get<Record<string, string>>('seen', {});
      const returning = Boolean(ctx.options.rememberPlayers && seen[player.steamId]);
      if (ctx.options.rememberPlayers) {
        seen[player.steamId] = new Date().toISOString();
        ctx.state.set('seen', seen);
      }
      if (returning && ctx.options.greetReturning === false) return; // known face: say nothing
      const text =
        returning && ctx.options.returningMessage
          ? String(ctx.options.returningMessage)
          : String(ctx.options.message);
      const t = setTimeout(() => {
        timers.delete(t);
        // Skip quietly if they already left during the delay.
        if (!ctx.snapshot()?.players.some((p) => p.steamId === player.steamId)) return;
        ctx.rcon
          .message(
            player.steamId,
            fill(text, {
              name: player.name,
              steamId: player.steamId,
              server: snapshot.status.serverName,
              players: snapshot.status.players.current,
              max: snapshot.status.players.max,
            }),
          )
          .then(() =>
            ctx.log.info(`welcomed ${player.name} (${player.steamId})${returning ? ' (returning)' : ''}`),
          )
          .catch((e: unknown) => ctx.log.warn(`welcome DM to ${player.steamId} failed`, e));
      }, Number(ctx.options.delayMs));
      timers.add(t);
    });
    ctx.log.info(
      ctx.options.greetReturning === false ? 'welcoming first-time visitors only' : 'welcoming every join',
    );
  },
});
