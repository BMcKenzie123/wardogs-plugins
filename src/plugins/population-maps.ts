import { definePlugin } from '../host/plugin.ts';
interface Tier {
  maxPlayers: number;
  maps: string[];
}
interface Options {
  tiers: Tier[];
  graceSeconds: number;
}
/** Chooses a map appropriate for the new-match population. */ export default definePlugin<Options>({
  name: 'population-maps',
  description: 'Changes map based on player population',
  defaults: {
    tiers: [
      { maxPlayers: 20, maps: ['Kavkazi'] },
      { maxPlayers: 999, maps: ['Europe'] },
    ],
    graceSeconds: 20,
  },
  setup(ctx) {
    let done = false;
    ctx.on('match.new', () => {
      done = false;
      setTimeout(() => {
        const snapshot = ctx.snapshot();
        if (done || !snapshot) return;
        const tier = ctx.options.tiers.find((row) => snapshot.status.players.current <= row.maxPlayers);
        if (tier && tier.maps.length && !tier.maps.includes(snapshot.status.map)) {
          done = true;
          ctx.rcon
            .changeMap({ map: tier.maps[Math.floor(Math.random() * tier.maps.length)]! })
            .catch((error: unknown) => ctx.log.warn('map change failed', error));
        }
      }, ctx.options.graceSeconds * 1000);
    });
    ctx.log.info(`${ctx.options.tiers.length} population tiers`);
  },
});
