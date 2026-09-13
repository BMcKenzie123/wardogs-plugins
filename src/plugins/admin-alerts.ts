import { definePlugin } from '../host/plugin.ts';
import { postJson } from '../host/http.ts';
interface Options {
  events: string[];
  ignorePeers: string[];
  webhookUrl: string;
}
/** Sends Discord notifications for selected audit actions. */ export default definePlugin<Options>({
  name: 'admin-alerts',
  description: 'Posts selected audit actions to Discord',
  defaults: { events: ['kick', 'ban', 'unban', 'config', 'map'], ignorePeers: [], webhookUrl: '' },
  setup(ctx) {
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl;
    if (!url) {
      ctx.log.warn('no webhook URL; plugin is idle');
      return;
    }
    ctx.on('audit.entry', async ({ entry }) => {
      if (
        ctx.options.ignorePeers.includes(entry.peer) ||
        !ctx.options.events.some((event) => entry.event.toLowerCase().includes(event.toLowerCase()))
      )
        return;
      await postJson(url, { content: `**${entry.event}** by ${entry.peer}: ${entry.detail}` });
    });
    ctx.log.info(`${ctx.options.events.length} audit event filters`);
  },
});
