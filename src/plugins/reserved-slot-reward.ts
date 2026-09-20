import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
interface Options {
  visits: number;
  message: string;
}
/** Grants a reserved slot to loyal visitors. */
export default definePlugin<Options>({
  name: 'reserved-slot-reward',
  description: 'Grants reserved slots after repeat visits',
  requires: [['POST', '/v1/reserved-slots']],
  defaults: { visits: 10, message: 'Thanks for visiting, {name}! You have earned a reserved slot.' },
  setup(ctx) {
    ctx.on('player.join', async ({ player, snapshot }) => {
      const visits = ctx.state.get<Record<string, number>>('visits', {});
      const granted = ctx.state.get<Record<string, boolean>>('granted', {});
      visits[player.steamId] = (visits[player.steamId] ?? 0) + 1;
      ctx.state.set('visits', visits);
      if (granted[player.steamId] || (visits[player.steamId] ?? 0) < Number(ctx.options.visits)) return;
      if (!(await ctx.rcon.reservedSlots()).reservedSlots.includes(player.steamId))
        await ctx.rcon.addReservedSlot(player.steamId);
      granted[player.steamId] = true;
      ctx.state.set('granted', granted);
      await ctx.rcon.message(
        player.steamId,
        fill(ctx.options.message, { name: player.name, server: snapshot.status.serverName }),
      );
      ctx.log.info(`granted ${player.steamId}`);
    });
    ctx.log.info(`reward at ${ctx.options.visits} visits`);
  },
});
