import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
import { postJson } from '../host/http.ts';
interface Options {
  atPlayers: number;
  message: string;
  oncePerHours: number;
  webhookUrl: string;
}
/** Posts when population reaches prime time. */ export default definePlugin<Options>({
  name: 'prime-time',
  description: 'Posts when server population reaches prime time',
  defaults: {
    atPlayers: 20,
    message: '{server} is popping: {players}/{max} online on {map}!',
    oncePerHours: 12,
    webhookUrl: '',
  },
  setup(ctx) {
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl;
    let prior = 0;
    ctx.on('tick', async ({ snapshot }) => {
      const current = snapshot.status.players.current;
      const last = ctx.state.get<number>('last', 0);
      if (
        prior < ctx.options.atPlayers &&
        current >= ctx.options.atPlayers &&
        url &&
        snapshot.at - last >= ctx.options.oncePerHours * 3_600_000
      ) {
        await postJson(url, {
          content: fill(ctx.options.message, {
            server: snapshot.status.serverName,
            players: current,
            max: snapshot.status.players.max,
            map: snapshot.status.map,
          }),
        });
        ctx.state.set('last', snapshot.at);
      }
      prior = current;
    });
    ctx.log.info(`threshold ${ctx.options.atPlayers} players`);
  },
});
