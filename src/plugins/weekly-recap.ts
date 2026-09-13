import { definePlugin } from '../host/plugin.ts';
import { postJson } from '../host/http.ts';
import { hourlyPlayerCounts, playtimeBySteamId, readStats, topByKills } from '../host/stats.ts';
import { nextOccurrence } from './event-announcer.ts';

interface Options {
  /** "mon" … "sun" or "*". */
  day: string;
  /** Local "HH:MM". */
  time: string;
  webhookUrl: string;
  top: number;
}

/** Builds the recap text from the last week's stats. Exported for tests. */
export function recapText(stats: Awaited<ReturnType<typeof readStats>>, top: number): string {
  const totals = playtimeBySteamId(stats.sessions);
  const killers = topByKills(stats.sessions, top);
  const grinders = [...totals.values()].sort((a, b) => b.minutes - a.minutes).slice(0, top);
  const hours = hourlyPlayerCounts(stats.snapshots)
    .map((avg, hour) => ({ avg, hour }))
    .filter((h) => h.avg > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);
  const lines = [
    `**Weekly recap** — ${totals.size} players, ${stats.sessions.length} sessions`,
    `Top killers: ${killers.map((p, i) => `${i + 1}. ${p.name} ${p.kills}K/${p.deaths}D`).join(' · ') || 'none'}`,
    `Most playtime: ${grinders.map((p, i) => `${i + 1}. ${p.name} ${Math.round(p.minutes)} min`).join(' · ') || 'none'}`,
    `Busiest hours: ${hours.map((h) => `${String(h.hour).padStart(2, '0')}:00 (${h.avg.toFixed(1)} avg)`).join(', ') || 'no data'}`,
  ];
  return lines.join('\n');
}

/** Posts a weekly summary of the stats-logger files to Discord. */
export default definePlugin<Options>({
  name: 'weekly-recap',
  description: 'Weekly Discord post: top killers, playtime, busiest hours',
  defaults: { day: 'sun', time: '18:00', webhookUrl: '', top: 5 },
  setup(ctx) {
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '';
    if (!url) {
      ctx.log.warn('no webhook URL (webhookUrl / DISCORD_WEBHOOK_URL); plugin is idle');
      return;
    }
    if (!nextOccurrence({ day: ctx.options.day, time: ctx.options.time }, new Date())) {
      ctx.log.warn(`invalid schedule "${ctx.options.day} ${ctx.options.time}"; plugin is idle`);
      return;
    }
    ctx.every(
      30_000,
      async () => {
        const now = new Date();
        const at = nextOccurrence({ day: ctx.options.day, time: ctx.options.time }, now);
        if (!at || now.getTime() < at.getTime() || now.getTime() >= at.getTime() + 60_000) return;
        const key = at.toISOString();
        const sent = ctx.state.get<Record<string, boolean>>('sent', {});
        if (sent[key]) return;

        const stats = await readStats(ctx.host.dataDir, now.getTime() - 7 * 86_400_000);
        await postJson(url, { username: 'WARDOGS', content: recapText(stats, Number(ctx.options.top)) });
        for (const k of Object.keys(sent))
          if (Date.parse(k) < now.getTime() - 14 * 86_400_000) delete sent[k];
        sent[key] = true;
        ctx.state.set('sent', sent);
        ctx.log.info(`posted weekly recap (${stats.sessions.length} sessions)`);
      },
      { immediate: true },
    );
    ctx.log.info(`recap every ${ctx.options.day} at ${ctx.options.time}`);
  },
});
