import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
import { playtimeBySteamId, readStats } from '../host/stats.ts';
import { postJson } from '../host/http.ts';

interface Options {
  everyMinutes: number;
  top: number;
  /** 0 = never post; otherwise post the top 10 to Discord on this cadence. */
  postEveryHours: number;
  webhookUrl: string;
}

/**
 * Aggregates the stats-logger files into data/leaderboard.json (all-time kills, deaths, minutes,
 * sessions). Rebuilt on a timer and a few seconds after any session ends, so the panel is current.
 */
export default definePlugin<Options>({
  name: 'leaderboard',
  description: 'Writes data/leaderboard.json from the stats files; optional Discord post',
  defaults: { everyMinutes: 30, top: 20, postEveryHours: 0, webhookUrl: '' },
  setup(ctx) {
    const file = path.join(ctx.host.dataDir, 'leaderboard.json');
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '';

    const rebuild = async (): Promise<void> => {
      const { sessions } = await readStats(ctx.host.dataDir, 0);
      const rows = [...playtimeBySteamId(sessions).values()]
        .map((row) => ({ ...row, minutes: Math.round(row.minutes) }))
        .sort((a, b) => b.kills - a.kills || b.minutes - a.minutes)
        .slice(0, Number(ctx.options.top));
      await fs.mkdir(ctx.host.dataDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify({ updatedAt: new Date().toISOString(), rows }, null, 2));

      const hours = Number(ctx.options.postEveryHours);
      const last = ctx.state.get<number>('lastPost', 0);
      if (url && hours > 0 && rows.length && Date.now() - last >= hours * 3_600_000) {
        const lines = rows
          .slice(0, 10)
          .map((r, i) => `${i + 1}. **${r.name}** ${r.kills}K/${r.deaths}D · ${r.minutes} min`);
        await postJson(url, {
          username: 'WARDOGS',
          content: `**All-time leaderboard**\n${lines.join('\n')}`,
        });
        ctx.state.set('lastPost', Date.now());
        ctx.log.info('posted leaderboard to Discord');
      }
    };

    ctx.every(Number(ctx.options.everyMinutes) * 60_000, rebuild, { immediate: true });

    // A session just ended: fold it in shortly (debounced, so a mass disconnect is one rebuild).
    let pending: NodeJS.Timeout | undefined;
    ctx.onStop(() => {
      if (pending) clearTimeout(pending);
    });
    ctx.on('player.leave', () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        rebuild().catch((e: unknown) => ctx.log.warn('rebuild failed', e));
      }, 3000);
    });
    ctx.log.info(
      `rebuilding top ${ctx.options.top} every ${ctx.options.everyMinutes} min and after sessions end`,
    );
  },
});
