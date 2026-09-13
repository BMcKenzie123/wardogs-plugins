import { definePlugin } from '../host/plugin.ts';
export default definePlugin({
  name: 'lighting-clock',
  description: 'Sets lighting to a daily schedule',
  defaults: { schedule: [] as Array<{ from: string; lighting: string }> },
  async setup(ctx) {
    // Best-effort validation only: the catalog shape is server-defined, so we just search its text.
    let catalog = '';
    try {
      catalog = JSON.stringify(await ctx.rcon.catalogLightings());
    } catch (e) {
      ctx.log.warn('could not fetch lighting catalog; skipping preset validation', e);
    }
    const schedule = Array.isArray(ctx.options.schedule)
      ? ctx.options.schedule
          .filter(
            (x): x is { from: string; lighting: string } =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as { from?: unknown }).from === 'string' &&
              typeof (x as { lighting?: unknown }).lighting === 'string',
          )
          .sort((a, b) => a.from.localeCompare(b.from))
      : [];
    for (const item of schedule)
      if (catalog && !catalog.includes(item.lighting))
        ctx.log.warn(`lighting not found in catalog: ${item.lighting}`);
    let last = '';
    ctx.every(
      60000,
      async () => {
        const snap = ctx.snapshot();
        if (!snap || !schedule.length) return;
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const item = [...schedule].reverse().find((x) => x.from <= time) ?? schedule.at(-1);
        if (item && item.lighting !== last && item.lighting !== snap.status.lighting) {
          await ctx.rcon.setLighting(item.lighting);
          last = item.lighting;
        }
      },
      { immediate: true },
    );
  },
});
