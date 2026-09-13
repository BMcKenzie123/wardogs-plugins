import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
import type { Player } from '../rcon/types.ts';

interface Options {
  /** How many players to name in the broadcast. */
  top: number;
  /** Skip matches that had fewer players than this at the end. */
  minPlayers: number;
  /** Broadcast template; {list} is "1. Name 12K/3D · 2. …", {map} the map that just ended. */
  broadcast: string;
  /** DM to the #1 player; empty string disables. */
  mvpMessage: string;
}

/** Kills desc, then deaths asc, then name — the order the shout-out uses. */
export function rankPlayers(players: Player[]): Player[] {
  return [...players].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name),
  );
}

/**
 * When a match ends (matchSeconds resets), broadcast the top players of the match that just finished
 * and DM the MVP a recruiting nudge. Good players are exactly who a clan wants to reach.
 */
export default definePlugin<Options>({
  name: 'match-mvp',
  description: 'Shouts out the top players at the end of each match and DMs the MVP',
  defaults: {
    top: 3,
    minPlayers: 4,
    broadcast: 'Match MVPs on {map}: {list}',
    mvpMessage:
      'MVP, {name}! {kills}K/{deaths}D. Players like you are who we recruit — say hi in Discord: discord.gg/your-invite',
  },
  setup(ctx) {
    ctx.on('match.new', async ({ previous, snapshot }) => {
      const ended = previous.players;
      if (ended.length < Number(ctx.options.minPlayers)) return;
      const ranked = rankPlayers(ended)
        .filter((p) => p.kills > 0)
        .slice(0, Number(ctx.options.top));
      if (!ranked.length) return;

      const list = ranked.map((p, i) => `${i + 1}. ${p.name} ${p.kills}K/${p.deaths}D`).join(' · ');
      await ctx.rcon.broadcast(fill(ctx.options.broadcast, { list, map: previous.status.map }));
      ctx.log.info(`match on ${previous.status.map} ended: ${list}`);

      const mvp = ranked[0];
      if (!mvp || !ctx.options.mvpMessage) return;
      // Only DM if they're still connected to the next match.
      if (!snapshot.players.some((p) => p.steamId === mvp.steamId)) return;
      await ctx.rcon.message(
        mvp.steamId,
        fill(ctx.options.mvpMessage, {
          name: mvp.name,
          steamId: mvp.steamId,
          kills: mvp.kills,
          deaths: mvp.deaths,
          map: previous.status.map,
        }),
      );
    });
  },
});
