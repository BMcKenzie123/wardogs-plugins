import { definePlugin } from '../host/plugin.ts';
import { SAY_MODES, say, sayMode } from '../host/say.ts';
import { fill } from '../host/template.ts';

interface Options {
  /** broadcast: the whole server hears about the streak. dm: a whisper to the player on the streak. */
  mode: 'broadcast' | 'dm';
  thresholds: number[];
  message: string;
}

/** Announces kill streak milestones within a match, publicly or to the player alone. */
export default definePlugin<Options>({
  name: 'kill-streak',
  description: 'Announces kill streak milestones (broadcast or whisper)',
  defaults: { mode: 'broadcast', thresholds: [5, 10, 20], message: '{name} is on a {kills}-kill streak!' },
  choices: { mode: SAY_MODES },
  setup(ctx) {
    const mode = sayMode(ctx.options.mode, 'broadcast');
    let starts = new Map<string, number>();
    let sent = new Set<string>();
    ctx.on('match.new', () => {
      starts = new Map();
      sent = new Set();
    });
    ctx.on('tick', async ({ snapshot }) => {
      for (const player of snapshot.players) {
        const base = starts.get(player.steamId) ?? player.kills;
        starts.set(player.steamId, base);
        const kills = player.kills - base;
        for (const threshold of ctx.options.thresholds) {
          const key = `${player.steamId}:${threshold}`;
          if (kills >= threshold && !sent.has(key)) {
            await say(
              ctx.rcon,
              mode,
              player.steamId,
              fill(ctx.options.message, { name: player.name, kills }),
            );
            sent.add(key);
          }
        }
      }
    });
    ctx.log.info(`${ctx.options.thresholds.length} streak thresholds (${mode})`);
  },
});
