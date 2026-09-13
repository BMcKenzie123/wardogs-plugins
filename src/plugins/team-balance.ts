import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
export default definePlugin({
  name: 'team-balance',
  description: 'Warns or moves uneven teams',
  requires: [['PATCH', '/v1/players/{id}']],
  defaults: {
    threshold: 3,
    autoMove: false,
    cooldownSeconds: 120,
    warnMessage: 'Teams are uneven ({a} vs {b}). Please switch.',
  },
  setup(ctx) {
    let cooldown = 0;
    const joined = new Map<string, number>();
    ctx.on('player.join', ({ player }) => {
      joined.set(player.steamId, Date.now());
    });
    ctx.on('tick', async ({ snapshot }) => {
      if (Date.now() < cooldown) return;
      const names = snapshot.status.factionScores.map((x) => x.name);
      const counts = new Map(names.map((x) => [x, 0]));
      for (const p of snapshot.players)
        if (counts.has(p.faction)) counts.set(p.faction, (counts.get(p.faction) ?? 0) + 1);
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const high = sorted[0],
        low = sorted.at(-1);
      if (!high || !low || high[1] - low[1] < Number(ctx.options.threshold)) return;
      await ctx.rcon.broadcast(
        fill(String(ctx.options.warnMessage), { a: `${high[0]} ${high[1]}`, b: `${low[0]} ${low[1]}` }),
      );
      if (ctx.options.autoMove) {
        // Move the most recently joined player on the big team (least invested in the round);
        // players we did not see join (present at baseline) rank oldest, then fewest kills breaks ties.
        const candidates = snapshot.players
          .filter((p) => p.faction === high[0])
          .sort((a, b) => {
            const ja = joined.get(a.steamId) ?? 0;
            const jb = joined.get(b.steamId) ?? 0;
            return jb !== ja ? jb - ja : a.kills - b.kills;
          });
        const p = candidates[0];
        if (p) {
          await ctx.rcon.setFaction(p.steamId, low[0]);
          await ctx.rcon.message(p.steamId, `You were moved to ${low[0]} to balance the teams.`);
          ctx.log.info(`moved ${p.name} (${p.steamId}) ${high[0]} → ${low[0]}`);
        }
      }
      cooldown = Date.now() + Number(ctx.options.cooldownSeconds) * 1000;
    });
  },
});
