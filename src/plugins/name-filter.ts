import { definePlugin } from '../host/plugin.ts';
interface Options {
  patterns: string[];
  kickReason: string;
  dmBeforeKick: string;
}
/** Removes players whose names match configured expressions. */ export default definePlugin<Options>({
  name: 'name-filter',
  description: 'Kicks names matching prohibited patterns',
  defaults: {
    patterns: ['(?i)\\bslur1\\b'],
    kickReason: 'Name violates server rules',
    dmBeforeKick: 'Your name breaks our rules; change it and rejoin.',
  },
  setup(ctx) {
    const patterns = ctx.options.patterns.flatMap((source) => {
      try {
        return [new RegExp(source.replace(/^\(\?i\)/, ''), source.startsWith('(?i)') ? 'i' : '')];
      } catch {
        ctx.log.warn(`invalid pattern ${source}`);
        return [];
      }
    });
    const kicked = new Set<string>();
    ctx.on('tick', async ({ snapshot }) => {
      for (const player of snapshot.players)
        if (!kicked.has(player.steamId) && patterns.some((pattern) => pattern.test(player.name))) {
          kicked.add(player.steamId);
          await ctx.rcon.message(player.steamId, ctx.options.dmBeforeKick);
          await ctx.rcon.kick(player.steamId, ctx.options.kickReason);
        }
    });
    ctx.log.info(`${patterns.length} name patterns`);
  },
});
