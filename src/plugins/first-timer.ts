import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
interface Options {
  message: string;
}
/** Greets each Steam account on its first visit. */
export default definePlugin<Options>({
  name: 'first-timer',
  description: 'Broadcasts a first-visit greeting',
  defaults: { message: 'First time on {server}: welcome {name}! Say hi.' },
  setup(ctx) {
    ctx.on('player.join', async ({ player, snapshot }) => {
      const seen = ctx.state.get<Record<string, boolean>>('seen', {});
      if (seen[player.steamId]) return;
      seen[player.steamId] = true;
      ctx.state.set('seen', seen);
      await ctx.rcon.broadcast(
        fill(ctx.options.message, { name: player.name, server: snapshot.status.serverName }),
      );
    });
    ctx.log.info('first visit greetings enabled');
  },
});
