import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';

export interface Tier {
  /** Fire when a player's visit count reaches exactly this number. */
  visits: number;
  message: string;
}

interface Options {
  tiers: Tier[];
  /** Wait this long after the join before the tier DM (so it lands after the welcome message). */
  delayMs: number;
  /** Write data/regulars.json — a leaderboard of who keeps coming back, for recruiting review. */
  leaderboardFile: boolean;
}

interface Record_ {
  name: string;
  visits: number;
  minutes: number;
  firstSeen: string;
  lastSeen: string;
}

export function tierFor(visits: number, tiers: Tier[]): Tier | undefined {
  return tiers.find((t) => Number(t.visits) === visits);
}

/**
 * Counts visits and play time per steamId, DMs milestone messages ("3rd visit — join the clan"),
 * and keeps a leaderboard file so you can see who your real regulars are. Play time accrues every
 * poll while the player is on, so the figures are live and a restart loses at most one poll.
 */
export default definePlugin<Options>({
  name: 'regulars',
  description: 'Tracks repeat visitors, sends milestone DMs, and writes a regulars leaderboard',
  defaults: {
    tiers: [
      {
        visits: 3,
        message: 'Third visit, {name}! You are officially a regular. Come say hi: discord.gg/your-invite',
      },
      {
        visits: 10,
        message: '{name}, {visits} visits and {minutes} minutes here. Want a reserved slot? Ask in Discord.',
      },
    ],
    delayMs: 12_000,
    leaderboardFile: true,
  },
  setup(ctx) {
    const tiers = Array.isArray(ctx.options.tiers) ? ctx.options.tiers : [];
    const file = path.join(ctx.host.dataDir, 'regulars.json');
    const timers = new Set<NodeJS.Timeout>();
    ctx.onStop(() => {
      for (const t of timers) clearTimeout(t);
    });

    const players = (): Record<string, Record_> => ctx.state.get<Record<string, Record_>>('players', {});

    const writeLeaderboard = async (): Promise<void> => {
      if (!ctx.options.leaderboardFile) return;
      const rows = Object.entries(players())
        .map(([steamId, r]) => ({ steamId, ...r, minutes: Math.round(r.minutes) }))
        .sort((a, b) => b.visits - a.visits || b.minutes - a.minutes);
      await fs.mkdir(ctx.host.dataDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(rows, null, 2));
    };

    const record = (steamId: string, name: string, at: string): Record_ => {
      const all = players();
      const rec = all[steamId] ?? { name, visits: 0, minutes: 0, firstSeen: at, lastSeen: at };
      all[steamId] = rec;
      ctx.state.set('players', all);
      return rec;
    };

    ctx.on('player.join', async ({ player, snapshot }) => {
      const now = new Date().toISOString();
      const rec = record(player.steamId, player.name, now);
      rec.visits += 1;
      rec.name = player.name;
      rec.lastSeen = now;
      ctx.state.set('players', players());

      const tier = tierFor(rec.visits, tiers);
      if (tier) {
        const t = setTimeout(() => {
          timers.delete(t);
          if (!ctx.snapshot()?.players.some((p) => p.steamId === player.steamId)) return;
          ctx.rcon
            .message(
              player.steamId,
              fill(tier.message, {
                name: player.name,
                visits: rec.visits,
                minutes: Math.round(rec.minutes),
                server: snapshot.status.serverName,
              }),
            )
            .then(() => ctx.log.info(`milestone ${rec.visits} visits → ${player.name} (${player.steamId})`))
            .catch((e: unknown) => ctx.log.warn(`milestone DM to ${player.steamId} failed`, e));
        }, Number(ctx.options.delayMs));
        timers.add(t);
      }
      await writeLeaderboard();
    });

    // Play time: credit every poll's interval to everyone on. Someone already on when the host started
    // (no join seen) gets a record on first sight, counted as one visit.
    let lastTick = 0;
    let lastWrite = 0;
    ctx.on('tick', async ({ snapshot }) => {
      const now = snapshot.at;
      const elapsed = lastTick ? Math.min(now - lastTick, 2 * ctx.host.pollMs + 1000) : 0;
      lastTick = now;
      if (!snapshot.players.length) return;
      const iso = new Date(now).toISOString();
      for (const p of snapshot.players) {
        const rec = record(p.steamId, p.name, iso);
        if (rec.visits === 0) rec.visits = 1;
        rec.name = p.name;
        rec.minutes += elapsed / 60_000;
        rec.lastSeen = iso;
      }
      ctx.state.set('players', players());
      if (now - lastWrite >= 60_000) {
        lastWrite = now;
        await writeLeaderboard();
      }
    });

    ctx.on('player.leave', async ({ player }) => {
      const all = players();
      const rec = all[player.steamId];
      if (!rec) return;
      rec.lastSeen = new Date().toISOString();
      ctx.state.set('players', all);
      await writeLeaderboard();
    });

    ctx.log.info(`${Object.keys(players()).length} known players; ${tiers.length} milestone tiers`);
  },
});
