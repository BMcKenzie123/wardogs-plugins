import { definePlugin } from '../host/plugin.ts';
import { requestJson } from '../host/http.ts';
interface Options {
  channelId: string;
  botToken: string;
  intervalSeconds: number;
  prefix: string;
  ignoreBots: boolean;
  maxLength: number;
  baseUrl: string;
}
interface DiscordMessage {
  id: string;
  content: string;
  author: { username: string; bot?: boolean };
}
/** Mirrors new Discord channel messages into the game. */
export default definePlugin<Options>({
  name: 'discord-announce-bridge',
  description: 'Bridges Discord channel messages into the server',
  defaults: {
    channelId: '',
    botToken: '',
    intervalSeconds: 60,
    prefix: '[Discord] ',
    ignoreBots: true,
    maxLength: 200,
    baseUrl: 'https://discord.com/api/v10',
  },
  setup(ctx) {
    const token = ctx.options.botToken || ctx.host.discordBotToken;
    if (!ctx.options.channelId || !token) {
      ctx.log.warn('channelId and DISCORD_BOT_TOKEN are required; plugin is idle');
      return;
    }
    ctx.every(
      Number(ctx.options.intervalSeconds) * 1000,
      async () => {
        const last = ctx.state.get<string>('lastId', '');
        const query = last ? `?limit=20&after=${encodeURIComponent(last)}` : '?limit=20';
        const messages = await requestJson<DiscordMessage[]>(
          'GET',
          `${ctx.options.baseUrl}/channels/${ctx.options.channelId}/messages${query}`,
          { headers: { Authorization: `Bot ${token}` } },
        );
        if (!last) {
          if (messages[0]) ctx.state.set('lastId', messages[0].id);
          return;
        }
        for (const message of [...messages].reverse()) {
          if (!message.content || (ctx.options.ignoreBots && message.author.bot)) continue;
          await ctx.rcon.broadcast(
            `${ctx.options.prefix}${message.author.username}: ${message.content.slice(0, Number(ctx.options.maxLength))}`,
          );
        }
        if (messages[0]) ctx.state.set('lastId', messages[0].id);
      },
      { immediate: true },
    );
    ctx.log.info(`bridging channel ${ctx.options.channelId}`);
  },
});
