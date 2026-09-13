import fs from 'node:fs/promises';
import { definePlugin } from '../host/plugin.ts';
import { getText } from '../host/http.ts';
export default definePlugin({
  name: 'ban-sync',
  description: 'Synchronizes bans from a list',
  defaults: { source: '', intervalMinutes: 15, removeUnlisted: false },
  setup(ctx) {
    ctx.every(
      Number(ctx.options.intervalMinutes) * 60000,
      async () => {
        const source = String(ctx.options.source);
        if (!source) return;
        const text = /^https?:\/\//.test(source) ? await getText(source) : await fs.readFile(source, 'utf8');
        const list: unknown = JSON.parse(text);
        if (!Array.isArray(list)) throw new Error('ban source must be an array');
        const desired = new Map(
          list
            .filter(
              (x): x is { steamId: string; reason?: string } =>
                !!x && typeof x === 'object' && typeof (x as { steamId?: unknown }).steamId === 'string',
            )
            .map((x) => [x.steamId, x]),
        );
        const current = await ctx.rcon.bans();
        let add = 0,
          remove = 0;
        for (const [id, ban] of desired)
          if (!current.bans.some((x) => x.steamId === id)) {
            await ctx.rcon.ban(id, ban.reason);
            add++;
          }
        if (ctx.options.removeUnlisted)
          for (const ban of current.bans)
            if (!desired.has(ban.steamId)) {
              await ctx.rcon.unban(ban.steamId);
              remove++;
            }
        ctx.log.info(`+${add} −${remove}`);
      },
      { immediate: true },
    );
  },
});
