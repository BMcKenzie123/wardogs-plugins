import { definePlugin } from '../host/plugin.ts';
interface Row {
  upToPlayers: number;
  scoreTick: number;
}
interface Options {
  table: Row[];
  cooldownSeconds: number;
}
/** Tunes score speed as population changes. */ export default definePlugin<Options>({
  name: 'score-tick-tuner',
  description: 'Adjusts score tick to player population',
  defaults: {
    table: [
      { upToPlayers: 20, scoreTick: 30 },
      { upToPlayers: 50, scoreTick: 24 },
      { upToPlayers: 999, scoreTick: 18 },
    ],
    cooldownSeconds: 120,
  },
  setup(ctx) {
    let last = 0;
    ctx.on('tick', async ({ snapshot }) => {
      const row = ctx.options.table.find((value) => snapshot.status.players.current <= value.upToPlayers);
      if (!row || snapshot.at - last < ctx.options.cooldownSeconds * 1000) return;
      const tick = Math.max(
        snapshot.status.scoreTick.min,
        Math.min(snapshot.status.scoreTick.max, row.scoreTick),
      );
      if (tick !== snapshot.status.scoreTick.current) {
        await ctx.rcon.patchSettings({ scoreTick: tick });
        last = snapshot.at;
      }
    });
    ctx.log.info(`${ctx.options.table.length} score rows`);
  },
});
