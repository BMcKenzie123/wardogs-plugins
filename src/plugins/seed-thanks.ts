import { definePlugin } from '../host/plugin.ts';
import { SAY_MODES } from '../host/say.ts';
import { fill } from '../host/template.ts';

interface Options {
  /** The server counts as "seeding" while the player count is below this. */
  belowPlayers: number;
  /** dm: thank each player once they have seeded this long. broadcast: thank everyone on a timer. */
  mode: 'dm' | 'broadcast';
  /** dm mode: minutes a player must have been on during seeding before the thank-you. */
  afterMinutes: number;
  /** dm mode: don't thank the same player again within this many hours. */
  oncePerHours: number;
  /** broadcast mode: interval between thank-yous while seeding (needs at least one player on). */
  broadcastEveryMinutes: number;
  message: string;
}

/**
 * Seeders are the people who sit on an empty server so it fills. Thank them: either a DM once
 * they've put in the minutes, or a periodic broadcast while the server is still filling.
 */
export default definePlugin<Options>({
  name: 'seed-thanks',
  description: 'Thanks players who seed the server while it is under-populated',
  choices: { mode: SAY_MODES },
  defaults: {
    belowPlayers: 24,
    mode: 'dm',
    afterMinutes: 15,
    oncePerHours: 20,
    broadcastEveryMinutes: 30,
    message:
      'Thank you for seeding with us today, {name}! Invite your friends for better games faster, and join us on Discord: discord.gg/your-invite',
  },
  setup(ctx) {
    const seeded = new Map<string, number>(); // ms of seeding time this session, per steamId
    const thanked = (): Record<string, number> => ctx.state.get<Record<string, number>>('thanked', {});

    ctx.on('player.leave', ({ player }) => {
      seeded.delete(player.steamId);
    });

    ctx.on('tick', async ({ snapshot, previous }) => {
      const seeding = snapshot.status.players.current < Number(ctx.options.belowPlayers);
      if (!seeding || !previous) return;

      if (ctx.options.mode === 'broadcast') {
        if (snapshot.status.players.current < 1) return;
        const last = ctx.state.get<number>('lastBroadcast', 0);
        if (snapshot.at - last < Number(ctx.options.broadcastEveryMinutes) * 60_000) return;
        await ctx.rcon.broadcast(
          fill(ctx.options.message, {
            name: 'everyone',
            server: snapshot.status.serverName,
            players: snapshot.status.players.current,
          }),
        );
        ctx.state.set('lastBroadcast', snapshot.at);
        ctx.log.info(`thanked ${snapshot.status.players.current} seeders (broadcast)`);
        return;
      }

      const delta = Math.max(0, snapshot.at - previous.at);
      const needed = Number(ctx.options.afterMinutes) * 60_000;
      const repeat = Number(ctx.options.oncePerHours) * 3_600_000;
      const done = thanked();
      let changed = false;
      for (const p of snapshot.players) {
        const total = (seeded.get(p.steamId) ?? 0) + delta;
        seeded.set(p.steamId, total);
        if (total < needed) continue;
        if (snapshot.at - (done[p.steamId] ?? 0) < repeat) continue;
        await ctx.rcon.message(
          p.steamId,
          fill(ctx.options.message, {
            name: p.name,
            steamId: p.steamId,
            server: snapshot.status.serverName,
            players: snapshot.status.players.current,
          }),
        );
        done[p.steamId] = snapshot.at;
        changed = true;
        ctx.log.info(`thanked seeder ${p.name} (${p.steamId}) after ${Math.round(total / 60_000)} min`);
      }
      if (changed) {
        // Forget entries older than the repeat window so the state file stays small.
        for (const [id, at] of Object.entries(done)) if (snapshot.at - at > repeat) delete done[id];
        ctx.state.set('thanked', done);
      }
    });

    ctx.log.info(
      `mode=${ctx.options.mode}, seeding below ${ctx.options.belowPlayers} players` +
        (ctx.options.mode === 'dm'
          ? `, DM after ${ctx.options.afterMinutes} min`
          : `, broadcast every ${ctx.options.broadcastEveryMinutes} min`),
    );
  },
});
