import { definePlugin } from '../host/plugin.ts';
interface Options {
  imageUrls: string[];
  everyHours: number;
}
/** Rotates sponsor images on a persistent cursor. */ export default definePlugin<Options>({
  name: 'sponsor-rotator',
  description: 'Rotates the sponsor banner',
  defaults: { imageUrls: [], everyHours: 6 },
  setup(ctx) {
    ctx.every(
      ctx.options.everyHours * 3_600_000,
      async () => {
        if (!ctx.options.imageUrls.length) return;
        const index = ctx.state.get<number>('index', 0) % ctx.options.imageUrls.length;
        const url = ctx.options.imageUrls[index]!;
        if ((await ctx.rcon.sponsor()).imageUrl !== url) await ctx.rcon.setSponsor(url);
        ctx.state.set('index', index + 1);
      },
      { immediate: true },
    );
    ctx.log.info(`${ctx.options.imageUrls.length} sponsor images`);
  },
});
