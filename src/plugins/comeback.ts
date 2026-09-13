import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';

interface Options {
  awayDays: number;
  delayMs: number;
  message: string;
}

/** DMs a player who comes back after a long absence. Last-seen times persist across restarts. */
export default definePlugin<Options>({
  name: 'comeback',
  description: 'DMs a player who returns after N days away',
  defaults: {
    awayDays: 14,
    delayMs: 8000,
    message:
      "Welcome back, {name}! It's been {days} days. Catch up with the regulars in Discord: discord.gg/your-invite",
  },
  setup(ctx) {
    const lastSeen = (): Record<string, number> => ctx.state.get<Record<string, number>>('lastSeen', {});
    const mark = (ids: string[]): void => {
      const all = lastSeen();
      const now = Date.now();
      for (const id of ids) all[id] = now;
      ctx.state.set('lastSeen', all);
    };

    ctx.on('player.join', ({ player }) => {
      const then = lastSeen()[player.steamId];
      const days = then === undefined ? 0 : Math.floor((Date.now() - then) / 86_400_000);
      mark([player.steamId]);
      if (days < Number(ctx.options.awayDays)) return;
      setTimeout(() => {
        if (!ctx.snapshot()?.players.some((p) => p.steamId === player.steamId)) return;
        ctx.rcon
          .message(
            player.steamId,
            fill(ctx.options.message, { name: player.name, days, steamId: player.steamId }),
          )
          .then(() => ctx.log.info(`welcomed back ${player.name} (${player.steamId}) after ${days} days`))
          .catch((e: unknown) => ctx.log.warn(`comeback DM to ${player.steamId} failed`, e));
      }, Number(ctx.options.delayMs));
    });
    ctx.on('player.leave', ({ player }) => mark([player.steamId]));

    // Refresh everyone present now and then, so a long session still counts as "seen" if the host restarts.
    let ticks = 0;
    ctx.on('tick', ({ snapshot }) => {
      if (++ticks % 15 === 0) mark(snapshot.players.map((p) => p.steamId));
    });
    ctx.log.info(
      `away threshold ${ctx.options.awayDays} days; ${Object.keys(lastSeen()).length} players remembered`,
    );
  },
});
