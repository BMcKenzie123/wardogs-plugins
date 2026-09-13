import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireWebServer } from '../host/webserver.ts';
import { definePlugin } from '../host/plugin.ts';
import { hourlyPlayerCounts, readStats } from '../host/stats.ts';
import { scoreOf } from './discord-relay.ts';

interface Options {
  path: string;
}

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function table(headers: string[], rows: unknown[][]): string {
  if (!rows.length) return '<p class="muted">nothing yet</p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const STYLE = `body{font:14px/1.4 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#222;background:#fafafa}
h1{margin:0 0 .25rem}h2{margin:2rem 0 .5rem;font-size:1.1rem}table{border-collapse:collapse;width:100%}
th,td{padding:.3rem .5rem;border-bottom:1px solid #ddd;text-align:left;font-variant-numeric:tabular-nums}th{background:#eee}
.muted{color:#777}.status{display:inline-block;padding:.1rem .5rem;border-radius:4px;color:#fff}.up{background:#2a9d5c}.down{background:#c0392b}
.bar{display:inline-block;height:.7rem;background:#3498db;vertical-align:middle}`;

/** A single self-contained status page on the shared HTTP listener (needs HTTP_PORT). */
export default definePlugin<Options>({
  name: 'web-dashboard',
  description: 'One-page HTML dashboard: status, players, leaderboard, regulars, hourly load',
  defaults: { path: '/' },
  setup(ctx) {
    if (!ctx.host.httpPort) {
      ctx.log.warn('HTTP_PORT is not set; plugin is idle');
      return;
    }
    const web = acquireWebServer(ctx.host.httpPort, ctx.log);
    const unregister = web.register({
      method: 'GET',
      path: ctx.options.path,
      handler: async (_req, res) => {
        const snap = ctx.snapshot();
        const up = ctx.serverUp();
        const status = snap?.status;

        const factions = status
          ? status.factionScores.map((f) => `${esc(f.name)} <b>${scoreOf(f) ?? ''}</b>`).join(' · ')
          : '';
        const players = table(
          ['Name', 'SteamID', 'Faction', 'Kills', 'Deaths', 'Cash', 'Ping'],
          (snap?.players ?? []).map((p) => [
            p.name,
            p.steamId,
            p.faction,
            p.kills,
            p.deaths,
            p.cash,
            p.pingMs,
          ]),
        );

        const board = await readJson<{ updatedAt: string; rows: Array<Record<string, unknown>> }>(
          path.join(ctx.host.dataDir, 'leaderboard.json'),
        );
        const leaderboard = table(
          ['#', 'Name', 'Kills', 'Deaths', 'Minutes', 'Sessions'],
          (board?.rows ?? [])
            .slice(0, 20)
            .map((r, i) => [
              i + 1,
              r.name,
              r.kills,
              r.deaths,
              Math.round(Number(r.minutes ?? 0)),
              r.sessions,
            ]),
        );

        const regulars = await readJson<Array<Record<string, unknown>>>(
          path.join(ctx.host.dataDir, 'regulars.json'),
        );
        const regularsTable = table(
          ['Name', 'Visits', 'Minutes', 'Last seen'],
          (regulars ?? []).slice(0, 20).map((r) => [
            r.name,
            r.visits,
            r.minutes,
            String(r.lastSeen ?? '')
              .slice(0, 16)
              .replace('T', ' '),
          ]),
        );

        const hours = hourlyPlayerCounts(
          (await readStats(ctx.host.dataDir, Date.now() - 86_400_000)).snapshots,
        );
        const peak = Math.max(1, ...hours);
        const hourly = hours
          .map(
            (avg, hour) =>
              `<tr><td>${String(hour).padStart(2, '0')}:00</td><td><span class="bar" style="width:${Math.round((avg / peak) * 200)}px"></span> ${avg.toFixed(1)}</td></tr>`,
          )
          .join('');

        const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30">
<title>${esc(status?.serverName ?? 'WARDOGS')}</title><style>${STYLE}</style></head><body>
<h1>${esc(status?.serverName ?? 'WARDOGS')} <span class="status ${up ? 'up' : 'down'}">${up ? 'up' : 'down'}</span></h1>
<p class="muted">${
          status
            ? `${esc(status.map)} · ${esc(status.experiences.join(' + ') || '-')} · ${esc(status.lighting)} · ${status.players.current}/${status.players.max} players · ${Math.floor(status.matchSeconds / 60)} min into match`
            : 'no data yet'
        }</p>
<p>${factions}</p>
<h2>Players online</h2>${players}
<h2>All-time leaderboard</h2>${leaderboard}
<h2>Regulars</h2>${regularsTable}
<h2>Average players by hour (last 24 h)</h2><table><tbody>${hourly}</tbody></table>
<p class="muted">wardogs-plugins · refreshes every 30 s</p></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      },
    });
    ctx.onStop(() => {
      unregister();
      web.release();
    });
    ctx.log.info(`dashboard at http://0.0.0.0:${ctx.host.httpPort}${ctx.options.path}`);
  },
});
