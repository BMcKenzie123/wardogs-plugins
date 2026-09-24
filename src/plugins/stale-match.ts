import { definePlugin } from '../host/plugin.ts';

interface Options {
  maxMinutes: number;
}

/**
 * Ends matches which exceed a configured age. Needs the server to report a match clock; builds that
 * omit `matchSeconds` (xREALM, 2026-09) leave this plugin idle, and it says so once.
 */
export default definePlugin<Options>({
  name: 'stale-match',
  description: 'Ends overly long matches',
  defaults: { maxMinutes: 90 },
  setup(ctx) {
    let done = false;
    let warned = false;
    ctx.on('match.new', () => {
      done = false;
    });
    ctx.on('tick', async ({ snapshot }) => {
      const seconds = snapshot.status.matchSeconds;
      if (typeof seconds !== 'number') {
        if (!warned) {
          warned = true;
          ctx.log.warn('this server build reports no match clock; stale-match is idle');
        }
        return;
      }
      if (!done && seconds > Number(ctx.options.maxMinutes) * 60) {
        done = true;
        await ctx.rcon.endMatch();
        ctx.log.info('ended stale match');
      }
    });
    ctx.log.info(`maximum ${ctx.options.maxMinutes} minutes`);
  },
});
