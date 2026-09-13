import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';

interface Options {
  afterMinutes: number;
  /** Only act when the server is at least this full (0–1). 0 = always. */
  onlyWhenAbove: number;
  warnMinutesBefore: number;
  kickReason: string;
  exemptReserved: boolean;
}

interface Activity {
  signature: string;
  since: number;
  warned: boolean;
}

/**
 * A player whose kills, deaths and cash have not changed for N minutes is idle. Warn, then kick,
 * but only when the server is full enough that the slot matters. The game has its own AFK kick;
 * this one is for seeding-friendly thresholds you control.
 */
export default definePlugin<Options>({
  name: 'afk-kick',
  description: 'Warns then kicks idle players when the server is nearly full',
  defaults: {
    afterMinutes: 10,
    onlyWhenAbove: 0.8,
    warnMinutesBefore: 2,
    kickReason: 'AFK for {minutes} min',
    exemptReserved: true,
  },
  setup(ctx) {
    const activity = new Map<string, Activity>();
    let reserved = new Set<string>();
    if (ctx.options.exemptReserved)
      ctx.every(
        300_000,
        async () => {
          reserved = new Set((await ctx.rcon.reservedSlots()).reservedSlots);
        },
        { immediate: true },
      );

    // A fresh session always starts the idle clock from zero.
    ctx.on('player.join', ({ player }) => {
      activity.delete(player.steamId);
    });
    ctx.on('player.leave', ({ player }) => {
      activity.delete(player.steamId);
    });

    ctx.on('tick', async ({ snapshot }) => {
      const { current, max } = snapshot.status.players;
      const busy = max > 0 && current / max >= Number(ctx.options.onlyWhenAbove);
      const kickAfter = Number(ctx.options.afterMinutes) * 60_000;
      const warnAfter = kickAfter - Number(ctx.options.warnMinutesBefore) * 60_000;

      for (const p of snapshot.players) {
        const signature = `${p.kills}/${p.deaths}/${p.cash}`;
        const row = activity.get(p.steamId);
        if (!row || row.signature !== signature) {
          activity.set(p.steamId, { signature, since: snapshot.at, warned: false });
          continue;
        }
        if (!busy || reserved.has(p.steamId)) continue;
        const idle = snapshot.at - row.since;
        if (!row.warned && idle >= warnAfter) {
          row.warned = true;
          await ctx.rcon.message(
            p.steamId,
            `You look AFK. You'll be kicked in ${ctx.options.warnMinutesBefore} min to free the slot.`,
          );
        }
        if (idle >= kickAfter) {
          activity.delete(p.steamId);
          await ctx.rcon.kick(p.steamId, fill(ctx.options.kickReason, { minutes: ctx.options.afterMinutes }));
          ctx.log.info(`kicked ${p.name} (${p.steamId}) after ${Math.round(idle / 60_000)} idle min`);
        }
      }
    });
    ctx.log.info(
      `kick after ${ctx.options.afterMinutes} min idle when ≥ ${Math.round(Number(ctx.options.onlyWhenAbove) * 100)}% full`,
    );
  },
});
