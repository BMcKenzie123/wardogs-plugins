import { definePlugin } from '../host/plugin.ts';
import { postJson } from '../host/http.ts';

interface Options {
  afterMinutes: number;
  webhookUrl: string;
  recoveredMessage: boolean;
}

/**
 * Quieter than discord-relay's instant server.down post: only alert when the server has stayed
 * unreachable for N minutes, then post once more when it comes back.
 */
export default definePlugin<Options>({
  name: 'downtime-alert',
  description: 'Discord alert when the server stays down N minutes, plus a recovery note',
  defaults: { afterMinutes: 5, webhookUrl: '', recoveredMessage: true },
  setup(ctx) {
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '';
    if (!url) {
      ctx.log.warn('no webhook URL (webhookUrl / DISCORD_WEBHOOK_URL); plugin is idle');
      return;
    }
    let downAt = 0;
    let alerted = false;
    let timer: NodeJS.Timeout | undefined;

    ctx.on('server.down', ({ error }) => {
      downAt = Date.now();
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = undefined;
          if (ctx.serverUp() || alerted) return;
          postJson(url, {
            username: 'WARDOGS',
            content: `:red_circle: Server unreachable for ${ctx.options.afterMinutes} min (${error.message}).`,
          })
            .then(() => {
              alerted = true;
              ctx.log.warn('posted downtime alert');
            })
            .catch((e: unknown) => ctx.log.warn('downtime post failed', e));
        },
        Number(ctx.options.afterMinutes) * 60_000,
      );
    });

    ctx.on('server.up', async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (alerted && ctx.options.recoveredMessage) {
        const minutes = Math.max(1, Math.round((Date.now() - downAt) / 60_000));
        await postJson(url, {
          username: 'WARDOGS',
          content: `:green_circle: Server is back after ${minutes} min.`,
        });
        ctx.log.info('posted recovery note');
      }
      alerted = false;
    });

    ctx.onStop(() => {
      if (timer) clearTimeout(timer);
    });
    ctx.log.info(`alert after ${ctx.options.afterMinutes} min down`);
  },
});
