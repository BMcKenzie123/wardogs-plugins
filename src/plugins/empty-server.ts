import { definePlugin } from '../host/plugin.ts';
export default definePlugin({
  name: 'empty-server',
  description: 'Changes state when server is empty',
  defaults: { afterMinutes: 10, map: '', experiences: [] as string[], lighting: '' },
  setup(ctx) {
    let since: number | undefined;
    let applied = false;
    ctx.on('tick', async ({ snapshot }) => {
      if (snapshot.status.players.current) {
        since = undefined;
        applied = false;
        return;
      }
      since ??= Date.now();
      if (applied || Date.now() - since < Number(ctx.options.afterMinutes) * 60000) return;
      const experiences = Array.isArray(ctx.options.experiences)
        ? ctx.options.experiences.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : [];
      if (ctx.options.map) {
        await ctx.rcon.changeMap({
          map: String(ctx.options.map),
          ...(experiences.length ? { experiences } : {}),
          ...(ctx.options.lighting ? { lighting: String(ctx.options.lighting) } : {}),
        });
        ctx.log.info(`server empty for ${ctx.options.afterMinutes} min; reset to ${ctx.options.map}`);
      } else if (ctx.options.lighting) {
        await ctx.rcon.setLighting(String(ctx.options.lighting));
        ctx.log.info(`server empty for ${ctx.options.afterMinutes} min; lighting → ${ctx.options.lighting}`);
      }
      applied = true;
    });
  },
});
