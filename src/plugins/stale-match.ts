import { definePlugin } from '../host/plugin.ts';
interface Options {
  maxMinutes: number;
}
/** Ends matches which exceed a configured age. */ export default definePlugin<Options>({
  name: 'stale-match',
  description: 'Ends overly long matches',
  defaults: { maxMinutes: 90 },
  setup(ctx) {
    let done = false;
    ctx.on('match.new', () => {
      done = false;
    });
    ctx.on('tick', async ({ snapshot }) => {
      if (!done && snapshot.status.matchSeconds > ctx.options.maxMinutes * 60) {
        done = true;
        await ctx.rcon.endMatch();
        ctx.log.info('ended stale match');
      }
    });
    ctx.log.info(`maximum ${ctx.options.maxMinutes} minutes`);
  },
});
