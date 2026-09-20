import { definePlugin } from '../host/plugin.ts';
import { sweepExpiredTempBans } from '../host/temp-bans.ts';

interface Options {
  checkSeconds: number;
}

/**
 * Lifts temporary bans when they expire. Temp bans come from the panel's Ban form (with a length) or
 * `wd tempban`; both record the expiry in data/temp-bans.json. The panel's Cleanup button runs the same sweep.
 */
export default definePlugin<Options>({
  name: 'temp-bans',
  description: 'Lifts temporary bans (panel or wd tempban) when they expire',
  defaults: { checkSeconds: 60 },
  setup(ctx) {
    ctx.every(
      Math.max(5, Number(ctx.options.checkSeconds)) * 1000,
      async () => {
        const lifted = await sweepExpiredTempBans(ctx.host.dataDir, ctx.rcon, ctx.log);
        for (const id of lifted) ctx.log.info(`lifted expired temp ban ${id}`);
      },
      { immediate: true },
    );
    ctx.log.info(`checking every ${ctx.options.checkSeconds}s`);
  },
});
