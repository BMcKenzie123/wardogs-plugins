import { definePlugin } from '../host/plugin.ts';

interface Tier {
  /** Applies while the player count is at or below this. First matching tier wins. */
  maxPlayers: number;
  /** Catalog map ids (as in `wd maps`), e.g. "Kavkazi". */
  maps: string[];
}

interface Options {
  tiers: Tier[];
  /** Seconds after a new match starts before deciding, so late joiners are counted. */
  graceSeconds: number;
}

/**
 * Switch to a map that suits the population just after a match starts: small maps when few are on,
 * big ones when the server is full. Compares against the rotation's current entry, because
 * `status.map` reports the level name (e.g. "Bakurani") while the catalog id is "Kavkazi".
 */
export default definePlugin<Options>({
  name: 'population-maps',
  description: 'Switches to a size-appropriate map just after a match starts',
  defaults: {
    tiers: [
      { maxPlayers: 20, maps: ['Kavkazi'] },
      { maxPlayers: 999, maps: ['Europe'] },
    ],
    graceSeconds: 20,
  },
  setup(ctx) {
    const tiers = (Array.isArray(ctx.options.tiers) ? ctx.options.tiers : []).filter(
      (t) => t && Array.isArray(t.maps) && t.maps.length > 0,
    );
    if (!tiers.length) {
      ctx.log.warn('no tiers configured; plugin is idle');
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    ctx.onStop(() => {
      if (timer) clearTimeout(timer);
    });

    const currentMapIds = async (statusMap: string): Promise<string[]> => {
      const ids = [statusMap];
      try {
        const rotation = await ctx.rcon.rotation();
        const now = rotation.entries.find((e) => e.status === 'now');
        if (now) ids.push(now.map);
      } catch {
        // rotation unavailable; fall back to status.map alone
      }
      return ids.map((s) => s.toLowerCase());
    };

    ctx.on('match.new', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = undefined;
          (async () => {
            const snapshot = ctx.snapshot();
            if (!snapshot) return;
            const tier = tiers.find((row) => snapshot.status.players.current <= Number(row.maxPlayers));
            if (!tier) return;
            const wanted = tier.maps.map((m) => m.toLowerCase());
            const current = await currentMapIds(snapshot.status.map);
            if (current.some((id) => wanted.includes(id))) return;
            const map = tier.maps[Math.floor(Math.random() * tier.maps.length)]!;
            await ctx.rcon.changeMap({ map });
            ctx.log.info(
              `${snapshot.status.players.current} players → switching ${snapshot.status.map} to ${map}`,
            );
          })().catch((e: unknown) => ctx.log.warn('map change failed', e));
        },
        Number(ctx.options.graceSeconds) * 1000,
      );
    });
    ctx.log.info(`${tiers.length} population tiers, deciding ${ctx.options.graceSeconds}s into each match`);
  },
});
