import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
interface Options {
  thresholds: number[];
  message: string;
}
/** Announces kill streak milestones in a match. */
export default definePlugin<Options>({
  name: 'kill-streak',
  description: 'Announces kill streak milestones',
  defaults: { thresholds: [5, 10, 20], message: '{name} is on a {kills}-kill streak!' },
  setup(ctx) {
    let starts = new Map<string, number>();
    let sent = new Set<string>();
    ctx.on('match.new', () => {
      starts = new Map();
      sent = new Set();
    });
    ctx.on('tick', async ({ snapshot }) => {
      for (const player of snapshot.players) {
        const base = starts.get(player.steamId) ?? player.kills;
        starts.set(player.steamId, base);
        const kills = player.kills - base;
        for (const threshold of ctx.options.thresholds) {
          const key = `${player.steamId}:${threshold}`;
          if (kills >= threshold && !sent.has(key)) {
            await ctx.rcon.broadcast(fill(ctx.options.message, { name: player.name, kills }));
            sent.add(key);
          }
        }
      }
    });
    ctx.log.info(`${ctx.options.thresholds.length} streak thresholds`);
  },
});
