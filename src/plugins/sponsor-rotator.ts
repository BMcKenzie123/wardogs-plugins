import { definePlugin } from '../host/plugin.ts';
import { sponsorUrlProblem } from '../host/sponsor.ts';

interface Options {
  /** 1024×256 PNG/JPEG links on catbox.moe, imgbb.com or postimg.cc; anything else is skipped. */
  imageUrls: string[];
  everyHours: number;
}

/** Cycles the sponsor banner through a list of approved-host image URLs; the cursor persists across restarts. */
export default definePlugin<Options>({
  name: 'sponsor-rotator',
  description: 'Cycles sponsor banner images',
  requires: [['PUT', '/v1/sponsor']],
  defaults: { imageUrls: [], everyHours: 6 },
  setup(ctx) {
    const urls = (Array.isArray(ctx.options.imageUrls) ? ctx.options.imageUrls : []).filter((url) => {
      const problem = sponsorUrlProblem(String(url));
      if (problem) ctx.log.warn(`skipping ${problem}`);
      return !problem;
    });
    if (!urls.length) {
      ctx.log.warn('no usable image URLs; plugin is idle');
      return;
    }
    ctx.every(
      Number(ctx.options.everyHours) * 3_600_000,
      async () => {
        const index = ctx.state.get<number>('index', 0) % urls.length;
        const url = urls[index]!;
        if ((await ctx.rcon.sponsor()).imageUrl !== url) {
          await ctx.rcon.setSponsor(url);
          ctx.log.info(`sponsor banner → ${url}`);
        }
        ctx.state.set('index', index + 1);
      },
      { immediate: true },
    );
    ctx.log.info(`${urls.length} banner(s), rotating every ${ctx.options.everyHours} h`);
  },
});
