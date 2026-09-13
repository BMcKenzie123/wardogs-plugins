import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
export default definePlugin({
  name: 'ping-guard',
  description: 'Warns and kicks high-ping players',
  defaults: {
    maxPingMs: 250,
    warnAfterPolls: 3,
    kickAfterPolls: 8,
    exemptReserved: true,
    exemptSteamIds: [] as string[],
    kickReason: 'Ping too high ({maxPingMs} ms)',
  },
  setup(ctx) {
    const strikes = new Map<string, number>();
    const reserved = new Set<string>();
    const refresh = async (): Promise<void> => {
      if (!ctx.options.exemptReserved) return;
      const { reservedSlots } = await ctx.rcon.reservedSlots();
      reserved.clear();
      for (const id of reservedSlots) reserved.add(id);
    };
    // ctx.every catches and logs handler errors, so a failed refresh never becomes an unhandled rejection.
    ctx.every(300_000, refresh, { immediate: true });
    ctx.on('tick', async ({ snapshot }) => {
      for (const p of snapshot.players) {
        if (
          (Array.isArray(ctx.options.exemptSteamIds) && ctx.options.exemptSteamIds.includes(p.steamId)) ||
          reserved.has(p.steamId)
        )
          continue;
        const n = p.pingMs > Number(ctx.options.maxPingMs) ? (strikes.get(p.steamId) ?? 0) + 1 : 0;
        strikes.set(p.steamId, n);
        if (n === Number(ctx.options.warnAfterPolls))
          await ctx.rcon.message(
            p.steamId,
            `Your ping (${p.pingMs} ms) is above the limit (${ctx.options.maxPingMs} ms). You'll be kicked if it stays high.`,
          );
        if (n >= Number(ctx.options.kickAfterPolls)) {
          await ctx.rcon.kick(
            p.steamId,
            fill(String(ctx.options.kickReason), { maxPingMs: ctx.options.maxPingMs, ping: p.pingMs }),
          );
          ctx.log.info(`kicked ${p.steamId}`);
          strikes.set(p.steamId, 0);
        }
      }
    });
  },
});
