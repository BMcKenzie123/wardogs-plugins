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
 * and keeps a leaderboard file so you can see who your real regulars are.
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

    const players = (): Record<string, Record_> => ctx.state.get<Record<string, Record_>>('players', {});

    const writeLeaderboard = async (): Promise<void> => {
      if (!ctx.options.leaderboardFile) return;
      const rows = Object.entries(players())
        .map(([steamId, r]) => ({ steamId, ...r, minutes: Math.round(r.minutes) }))
        .sort((a, b) => b.visits - a.visits || b.minutes - a.minutes);
      await fs.mkdir(ctx.host.dataDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(rows, null, 2));
    };

    ctx.on('player.join', async ({ player, snapshot }) => {
      const all = players();
      const now = new Date().toISOString();
      const rec: Record_ = all[player.steamId] ?? {
        name: player.name,
        visits: 0,
        minutes: 0,
        firstSeen: now,
        lastSeen: now,
      };
      rec.visits += 1;
      rec.name = player.name;
      rec.lastSeen = now;
      all[player.steamId] = rec;
      ctx.state.set('players', all);

      const tier = tierFor(rec.visits, tiers);
      if (tier) {
        setTimeout(() => {
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
      }
      await writeLeaderboard();
    });

    ctx.on('player.leave', async ({ player, sessionSeconds, observedSeconds }) => {
      const all = players();
      const rec = all[player.steamId];
      if (!rec) return;
      rec.minutes += (sessionSeconds ?? observedSeconds) / 60;
      rec.lastSeen = new Date().toISOString();
      ctx.state.set('players', all);
      await writeLeaderboard();
    });

    ctx.log.info(`${Object.keys(players()).length} known players; ${tiers.length} milestone tiers`);
  },
});
