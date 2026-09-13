import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
interface Options {
  checkSeconds: number;
}
interface TempBan {
  steamId: string;
  reason: string;
  expiresAt: string;
}
/** Removes expired CLI-created temporary bans. */ export default definePlugin<Options>({
  name: 'temp-bans',
  description: 'Expires temporary bans created by wd tempban',
  defaults: { checkSeconds: 60 },
  setup(ctx) {
    const file = path.join(ctx.host.dataDir, 'temp-bans.json');
    const check = async () => {
      let bans: TempBan[] = [];
      try {
        bans = JSON.parse(await fs.readFile(file, 'utf8')) as TempBan[];
      } catch {
        return;
      }
      const active: TempBan[] = [];
      for (const ban of bans) {
        if (Date.parse(ban.expiresAt) <= Date.now()) {
          await ctx.rcon.unban(ban.steamId);
          ctx.log.info(`expired ${ban.steamId}`);
        } else active.push(ban);
      }
      await fs.writeFile(file, JSON.stringify(active, null, 2));
    };
    ctx.every(ctx.options.checkSeconds * 1000, check, { immediate: true });
    ctx.log.info(`checking every ${ctx.options.checkSeconds}s`);
  },
});
