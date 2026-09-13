import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
export default definePlugin({
  name: 'welcome',
  description: 'Sends a welcome DM',
  defaults: { delayMs: 6000, message: 'Welcome, {name}!', returningMessage: '', rememberPlayers: true },
  setup(ctx) {
    ctx.on('player.join', ({ player, snapshot }) => {
      const seen = ctx.state.get<Record<string, string>>('seen', {});
      const text =
        ctx.options.rememberPlayers && seen[player.steamId] && ctx.options.returningMessage
          ? String(ctx.options.returningMessage)
          : String(ctx.options.message);
      setTimeout(() => {
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
          .then(() => ctx.log.info(`welcomed ${player.name} (${player.steamId})`))
          .catch((e: unknown) => ctx.log.warn(`welcome DM to ${player.steamId} failed`, e));
      }, Number(ctx.options.delayMs));
      if (ctx.options.rememberPlayers) {
        seen[player.steamId] = new Date().toISOString();
        ctx.state.set('seen', seen);
      }
    });
  },
});
