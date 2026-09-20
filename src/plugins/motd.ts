import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';

interface Options {
  intervalMinutes: number;
  /** Only broadcast while at least this many players are on. */
  minPlayers: number;
  messages: string[];
}

/**
 * Broadcasts the next line of the rotation every N minutes while players are on. The cadence survives
 * restarts and option saves: the time of the last send is kept, so a restart never pushes the next line
 * a full interval away, and every send is logged so the panel's activity view shows it.
 */
export default definePlugin<Options>({
  name: 'motd',
  description: 'Periodic broadcast messages',
  defaults: { intervalMinutes: 10, minPlayers: 1, messages: [] as string[] },
  setup(ctx) {
    const messages = (Array.isArray(ctx.options.messages) ? ctx.options.messages : [])
      .map(String)
      .filter(Boolean);
    if (!messages.length) {
      ctx.log.warn('no messages configured');
      return;
    }
    const interval = Math.max(1000, Number(ctx.options.intervalMinutes) * 60_000);
    let stopped = false;
    let first: NodeJS.Timeout | undefined;
    ctx.onStop(() => {
      stopped = true;
      if (first) clearTimeout(first);
    });

    const send = async (): Promise<void> => {
      const s = ctx.snapshot();
      if (!s || s.status.players.current < Number(ctx.options.minPlayers)) return;
      const i = ctx.state.get<number>('index', 0);
      const line = fill(messages[i % messages.length]!); // {discord} and other globals
      await ctx.rcon.broadcast(line);
      ctx.state.set('index', i + 1);
      ctx.state.set('lastSentAt', Date.now());
      ctx.log.info(`motd ${(i % messages.length) + 1}/${messages.length}: ${line}`);
    };

    // First send: the remainder of the interval since the last send, so a save or a restart does not
    // reset the countdown. Never sent before: one full interval.
    const last = ctx.state.get<number>('lastSentAt', 0);
    const due = last > 0 ? Math.max(1000, interval - (Date.now() - last)) : interval;
    first = setTimeout(() => {
      first = undefined;
      send()
        .catch((e: unknown) => ctx.log.warn('broadcast failed', e))
        .finally(() => {
          if (!stopped) ctx.every(interval, send);
        });
    }, due);
    ctx.log.info(
      `${messages.length} line(s) every ${ctx.options.intervalMinutes} min while ${ctx.options.minPlayers}+ on; next in ${Math.round(due / 1000)} s`,
    );
  },
});
