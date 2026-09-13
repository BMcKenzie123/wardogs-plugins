import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
interface Rank {
  hours: number;
  title: string;
}
interface Options {
  ranks: Rank[];
  announce: string;
}
/** Announces persistent playtime rank promotions. */
export default definePlugin<Options>({
  name: 'playtime-ranks',
  description: 'Awards playtime rank announcements',
  defaults: {
    ranks: [
      { hours: 1, title: 'Regular' },
      { hours: 10, title: 'Veteran' },
      { hours: 50, title: 'Legend' },
    ],
    announce: '{name} just reached {title} ({hours} h on {server})!',
  },
  setup(ctx) {
    const check = async (id: string, name: string, server: string) => {
      const minutes = ctx.state.get<Record<string, number>>('minutes', {});
      const announced = ctx.state.get<Record<string, number>>('announced', {});
      for (let index = 0; index < ctx.options.ranks.length; index += 1) {
        const rank = ctx.options.ranks[index]!;
        if ((minutes[id] ?? 0) >= rank.hours * 60 && (announced[id] ?? -1) < index) {
          await ctx.rcon.broadcast(
            fill(ctx.options.announce, { name, title: rank.title, hours: rank.hours, server }),
          );
          announced[id] = index;
          ctx.state.set('announced', announced);
        }
      }
    };
    ctx.on('player.join', ({ player, snapshot }) =>
      check(player.steamId, player.name, snapshot.status.serverName),
    );
    ctx.on('player.leave', async ({ player, sessionSeconds, snapshot }) => {
      if (sessionSeconds !== null) {
        const minutes = ctx.state.get<Record<string, number>>('minutes', {});
        minutes[player.steamId] = (minutes[player.steamId] ?? 0) + sessionSeconds / 60;
        ctx.state.set('minutes', minutes);
      }
      await check(player.steamId, player.name, snapshot.status.serverName);
    });
    ctx.log.info(`${ctx.options.ranks.length} ranks`);
  },
});
