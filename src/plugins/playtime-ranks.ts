import { definePlugin } from '../host/plugin.ts';
import { SAY_MODES, say, sayMode } from '../host/say.ts';
import { fill } from '../host/template.ts';

interface Rank {
  hours: number;
  title: string;
}

interface Options {
  /** broadcast: everyone hears the promotion. dm: a whisper to the player. */
  mode: 'broadcast' | 'dm';
  ranks: Rank[];
  announce: string;
}

/**
 * Persistent play-time ranks. Time accrues every poll while a player is on (so a crash or restart
 * loses at most one poll), and a promotion is announced the moment the threshold is crossed.
 */
export default definePlugin<Options>({
  name: 'playtime-ranks',
  description: 'Awards playtime ranks (broadcast or whisper)',
  defaults: {
    mode: 'broadcast',
    ranks: [
      { hours: 1, title: 'Regular' },
      { hours: 10, title: 'Veteran' },
      { hours: 50, title: 'Legend' },
    ],
    announce: '{name} just reached {title} ({hours} h on {server})!',
  },
  choices: { mode: SAY_MODES },
  setup(ctx) {
    const mode = sayMode(ctx.options.mode, 'broadcast');
    const ranks = Array.isArray(ctx.options.ranks) ? ctx.options.ranks : [];
    let lastTick = 0;

    ctx.on('tick', async ({ snapshot }) => {
      const now = snapshot.at;
      // Credit only time we actually watched: a gap longer than two polls (outage, restart) is not played time.
      const elapsed = lastTick ? Math.min(now - lastTick, 2 * ctx.host.pollMs + 1000) : 0;
      lastTick = now;
      if (!elapsed || !snapshot.players.length) return;
      const minutes = ctx.state.get<Record<string, number>>('minutes', {});
      const announced = ctx.state.get<Record<string, number>>('announced', {});
      for (const p of snapshot.players) minutes[p.steamId] = (minutes[p.steamId] ?? 0) + elapsed / 60_000;
      ctx.state.set('minutes', minutes);
      for (const p of snapshot.players) {
        for (let index = 0; index < ranks.length; index += 1) {
          const rank = ranks[index]!;
          if ((minutes[p.steamId] ?? 0) >= Number(rank.hours) * 60 && (announced[p.steamId] ?? -1) < index) {
            await say(
              ctx.rcon,
              mode,
              p.steamId,
              fill(ctx.options.announce, {
                name: p.name,
                title: rank.title,
                hours: rank.hours,
                server: snapshot.status.serverName,
              }),
            );
            announced[p.steamId] = index;
            ctx.state.set('announced', announced);
          }
        }
      }
    });
    ctx.log.info(`${ranks.length} ranks (${mode})`);
  },
});
