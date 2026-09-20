import { definePlugin } from '../host/plugin.ts';
import { SAY_MODES, say, sayMode } from '../host/say.ts';
import { fill } from '../host/template.ts';

interface Rank {
  hours: number;
  title: string;
}

interface Options {
  /** broadcast: everyone hears the promotion. dm: a whisper to the player, delivered while they are on. */
  mode: 'broadcast' | 'dm';
  ranks: Rank[];
  announce: string;
}

/**
 * Announces persistent playtime rank promotions. Time is credited when a session ends, so a rank
 * crossed at leave time is broadcast right away; in dm mode it waits for the player's next join.
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
    const check = async (id: string, name: string, server: string, present: boolean) => {
      if (mode === 'dm' && !present) return; // nobody to whisper to; it fires on their next join
      const minutes = ctx.state.get<Record<string, number>>('minutes', {});
      const announced = ctx.state.get<Record<string, number>>('announced', {});
      for (let index = 0; index < ctx.options.ranks.length; index += 1) {
        const rank = ctx.options.ranks[index]!;
        if ((minutes[id] ?? 0) >= rank.hours * 60 && (announced[id] ?? -1) < index) {
          await say(
            ctx.rcon,
            mode,
            id,
            fill(ctx.options.announce, { name, title: rank.title, hours: rank.hours, server }),
          );
          announced[id] = index;
          ctx.state.set('announced', announced);
        }
      }
    };
    ctx.on('player.join', ({ player, snapshot }) =>
      check(player.steamId, player.name, snapshot.status.serverName, true),
    );
    ctx.on('player.leave', async ({ player, sessionSeconds, observedSeconds, snapshot }) => {
      const minutes = ctx.state.get<Record<string, number>>('minutes', {});
      minutes[player.steamId] = (minutes[player.steamId] ?? 0) + (sessionSeconds ?? observedSeconds) / 60;
      ctx.state.set('minutes', minutes);
      await check(player.steamId, player.name, snapshot.status.serverName, false);
    });
    ctx.log.info(`${ctx.options.ranks.length} ranks (${mode})`);
  },
});
