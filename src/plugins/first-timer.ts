import { definePlugin } from '../host/plugin.ts';
import { SAY_MODES, say, sayMode } from '../host/say.ts';
import { fill } from '../host/template.ts';

interface Options {
  /** broadcast: everyone sees the greeting. dm: a whisper to the newcomer only. */
  mode: 'broadcast' | 'dm';
  /** dm mode: wait this long after the join so the player is actually in-game to read it. */
  delayMs: number;
  message: string;
}

/** Greets each Steam account on its first visit, either publicly or as a private message. */
export default definePlugin<Options>({
  name: 'first-timer',
  description: 'Greets a first-visit player: broadcast, or a whisper to them',
  defaults: { mode: 'broadcast', delayMs: 5000, message: 'First time on {server}: welcome {name}! Say hi.' },
  choices: { mode: SAY_MODES },
  setup(ctx) {
    const mode = sayMode(ctx.options.mode, 'broadcast');
    const timers = new Set<NodeJS.Timeout>();
    ctx.onStop(() => {
      for (const t of timers) clearTimeout(t);
    });
    ctx.on('player.join', async ({ player, snapshot }) => {
      const seen = ctx.state.get<Record<string, boolean>>('seen', {});
      if (seen[player.steamId]) return;
      seen[player.steamId] = true;
      ctx.state.set('seen', seen);
      const text = fill(ctx.options.message, { name: player.name, server: snapshot.status.serverName });
      if (mode === 'broadcast') {
        await ctx.rcon.broadcast(text);
        return;
      }
      const t = setTimeout(() => {
        timers.delete(t);
        if (!ctx.snapshot()?.players.some((p) => p.steamId === player.steamId)) return;
        say(ctx.rcon, 'dm', player.steamId, text).catch((e: unknown) =>
          ctx.log.warn(`first-timer DM to ${player.steamId} failed`, e),
        );
      }, Number(ctx.options.delayMs));
      timers.add(t);
    });
    ctx.log.info(`first visit greetings enabled (${mode})`);
  },
});
