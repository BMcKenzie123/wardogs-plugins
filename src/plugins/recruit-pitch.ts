import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';

interface Options {
  /** Minutes a player must have been in this session before the pitch. */
  afterMinutes: number;
  /** Only pitch players with at least this many kills (0 = everyone). */
  minKills: number;
  /** Re-pitch the same player after this many days. 0 = once, ever. */
  repeatAfterDays: number;
  /** At most this many pitches per poll, so a full server never gets a burst (67 in one second, 2026-09-24). */
  maxPerTick: number;
  message: string;
}

/**
 * The welcome plugin greets on join; this one waits until someone has actually put time into the
 * server, then sends a single recruiting DM. Who has been pitched is persisted so restarts don't nag.
 */
export default definePlugin<Options>({
  name: 'recruit-pitch',
  description: 'DMs a recruiting pitch once a player has put real time into a session',
  defaults: {
    afterMinutes: 15,
    minKills: 0,
    repeatAfterDays: 7,
    maxPerTick: 3,
    message:
      'Enjoying {server}, {name}? We are recruiting — join the Discord and play with the regulars: discord.gg/your-invite',
  },
  setup(ctx) {
    // Session start per player: the join event when we saw it, else the first poll we saw them in.
    const since = new Map<string, number>();
    ctx.on('player.leave', ({ player }) => {
      since.delete(player.steamId);
    });
    ctx.on('tick', async ({ snapshot }) => {
      const now = snapshot.at;
      const minMs = Number(ctx.options.afterMinutes) * 60_000;
      const repeatMs = Number(ctx.options.repeatAfterDays) * 86_400_000;
      const pitched = ctx.state.get<Record<string, string>>('pitched', {});
      const cap = Math.max(1, Number(ctx.options.maxPerTick) || 3);
      let sent = 0;
      for (const p of snapshot.players) {
        if (sent >= cap) break; // the rest get theirs on the next polls
        let start = since.get(p.steamId);
        if (start === undefined) {
          start = now;
          since.set(p.steamId, now);
        }
        if (now - start < minMs) continue;
        if (p.kills < Number(ctx.options.minKills)) continue;
        const last = pitched[p.steamId];
        if (last !== undefined && (repeatMs <= 0 || now - Date.parse(last) < repeatMs)) continue;

        await ctx.rcon.message(
          p.steamId,
          fill(ctx.options.message, {
            name: p.name,
            steamId: p.steamId,
            server: snapshot.status.serverName,
            players: snapshot.status.players.current,
            max: snapshot.status.players.max,
            kills: p.kills,
          }),
        );
        sent += 1;
        pitched[p.steamId] = new Date(now).toISOString();
        ctx.state.set('pitched', pitched);
        ctx.log.info(`pitched ${p.name} (${p.steamId}) after ${Math.round((now - start) / 60_000)} min`);
      }
    });
  },
});
