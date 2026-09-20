import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireWebServer } from '../host/webserver.ts';
import { definePlugin } from '../host/plugin.ts';
import { hourlyPlayerCounts, readStats } from '../host/stats.ts';
import { scoreOf } from './discord-relay.ts';
import type { HostConfig } from '../config.ts';
import type { Snapshot } from '../host/events.ts';

interface Options {
  path: string;
}

/** The slice of a plugin context the page builders need; admin-panel reuses them. */
export interface View {
  host: HostConfig;
  snapshot(): Snapshot | null;
  serverUp(): boolean;
}

export const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function table(headers: string[], rows: unknown[][]): string {
  if (!rows.length) return '<p class="muted">nothing yet</p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Dark theme in the TAW WARDOGS palette: Charcoal #1C1C1C, Slate #3A3A3A, Steel #6E6E6E, Fog #C7C7C7,
 * Primary Red #930000, Ember #C1272D, Deep Maroon #5C0000, Gunmetal Teal #2F4858, Tactical Gold #C9A227.
 */
export const STYLE = `body{font:14px/1.45 system-ui,sans-serif;max-width:1180px;margin:0 auto;padding:1.25rem 1rem 2rem;color:#C7C7C7;background:#1C1C1C}
body::before{content:"";display:block;height:4px;background:#930000;margin:-1.25rem -1rem 1.25rem}
h1{margin:0 0 .25rem;font-size:1.5rem;color:#fff}
h2{margin:1.75rem 0 .5rem;font-size:.95rem;letter-spacing:.08em;text-transform:uppercase;color:#fff;border-bottom:2px solid #930000;display:inline-block;padding-bottom:.15rem}
b{color:#fff}a{color:#C9A227}
table{border-collapse:collapse;width:100%}th,td{padding:.35rem .5rem;border-bottom:1px solid #3A3A3A;text-align:left;font-variant-numeric:tabular-nums;vertical-align:middle}
th{background:#242424;color:#fff;font-weight:600}tbody tr:hover td{background:#222}
.muted{color:#6E6E6E}
.status{display:inline-block;padding:.1rem .5rem;border-radius:4px;color:#fff;font-size:.8rem;vertical-align:middle}.up{background:#2F4858}.down{background:#C1272D}
.bar{display:inline-block;height:.7rem;background:#C9A227;vertical-align:middle}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}
form.inline{display:inline-flex;gap:.3rem;align-items:center;margin:0;flex-wrap:wrap}
form.card{background:#242424;border:1px solid #3A3A3A;border-radius:6px;padding:.75rem;display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
input,select{padding:.3rem .4rem;border:1px solid #3A3A3A;border-radius:4px;font:inherit;background:#1C1C1C;color:#fff}input[type=text]{min-width:8rem}input::placeholder{color:#6E6E6E}
input:focus,select:focus{outline:none;border-color:#C9A227}
button{padding:.3rem .6rem;border:1px solid #930000;background:#930000;color:#fff;border-radius:4px;font:inherit;cursor:pointer}button:hover{background:#C1272D;border-color:#C1272D}
button.soft{background:transparent;color:#C7C7C7;border-color:#6E6E6E}button.soft:hover{background:#3A3A3A;border-color:#C7C7C7;color:#fff}
button.warn{background:#5C0000;border-color:#C1272D}button.warn:hover{background:#C1272D}
.flash{background:#2a2411;border:1px solid #C9A227;color:#fff;padding:.5rem .75rem;border-radius:4px;margin:.75rem 0;position:sticky;top:.5rem;z-index:5;box-shadow:0 2px 10px #000c}
.tag{font-size:.75rem;color:#C7C7C7;background:#3A3A3A;border-radius:3px;padding:.05rem .35rem}
.pill{display:inline-block;padding:.05rem .5rem;border-radius:999px;font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.pill.enabled{background:#2F4858;color:#fff}.pill.disabled{background:#3A3A3A;color:#C7C7C7}.pill.skipped{background:#5C0000;color:#fff}.pill.failed{background:#C1272D;color:#fff}
pre.log{background:#111;border:1px solid #3A3A3A;border-radius:6px;padding:.6rem .8rem;max-height:22rem;overflow:auto;font:12px/1.45 ui-monospace,Consolas,monospace;color:#C7C7C7;white-space:pre-wrap;margin:0}
pre.log .warn{color:#C9A227}pre.log .err{color:#C1272D}pre.log .who{color:#fff}
tr.opts td{padding:0 .5rem .5rem;background:#1F1F1F;border-bottom:1px solid #3A3A3A}tbody tr.opts:hover td{background:#1F1F1F}
details{margin:.3rem 0 0}summary{cursor:pointer;color:#C9A227;font-size:.85rem;user-select:none}summary:hover{color:#fff}
form.opts{display:block;margin:.5rem 0 0;padding:.75rem;background:#242424;border:1px solid #3A3A3A;border-radius:6px}
.fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.6rem .9rem;margin:0 0 .6rem}
.field{display:flex;flex-direction:column;gap:.2rem;min-width:0}.field.wide{grid-column:1/-1}.field label{color:#fff;font-size:.85rem}
.field input,.field select,.field textarea{width:100%;box-sizing:border-box}
textarea{padding:.3rem .4rem;border:1px solid #3A3A3A;border-radius:4px;font:12px/1.45 ui-monospace,Consolas,monospace;background:#1C1C1C;color:#fff;resize:vertical}textarea:focus{outline:none;border-color:#C9A227}
.def{color:#6E6E6E;font-size:.75rem;font-weight:400;text-transform:none;letter-spacing:0}
.row{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}`;

export function statusHeader(view: View): string {
  const snap = view.snapshot();
  const up = view.serverUp();
  const status = snap?.status;
  const line = status
    ? `${esc(status.map)} · ${esc(status.experiences.join(' + ') || '-')} · ${esc(status.lighting)} · ${status.players.current}/${status.players.max} players · ${Math.floor(status.matchSeconds / 60)} min into match · score tick ${status.scoreTick.current}s`
    : 'no data yet';
  const factions = status
    ? status.factionScores.map((f) => `${esc(f.name)} <b>${scoreOf(f) ?? ''}</b>`).join(' · ')
    : '';
  return `<h1>${esc(status?.serverName ?? 'WARDOGS')} <span class="status ${up ? 'up' : 'down'}">${up ? 'up' : 'down'}</span></h1>
<p class="muted">${line}</p><p>${factions}</p>`;
}

export function playersTable(view: View): string {
  const snap = view.snapshot();
  return table(
    ['Name', 'SteamID', 'Faction', 'Kills', 'Deaths', 'Cash', 'Ping'],
    (snap?.players ?? []).map((p) => [p.name, p.steamId, p.faction, p.kills, p.deaths, p.cash, p.pingMs]),
  );
}

export async function leaderboardSection(view: View): Promise<string> {
  const board = await readJson<{ updatedAt: string; rows: Array<Record<string, unknown>> }>(
    path.join(view.host.dataDir, 'leaderboard.json'),
  );
  return table(
    ['#', 'Name', 'Kills', 'Deaths', 'Minutes', 'Sessions'],
    (board?.rows ?? [])
      .slice(0, 20)
      .map((r, i) => [i + 1, r.name, r.kills, r.deaths, Math.round(Number(r.minutes ?? 0)), r.sessions]),
  );
}

export async function regularsSection(view: View): Promise<string> {
  const regulars = await readJson<Array<Record<string, unknown>>>(
    path.join(view.host.dataDir, 'regulars.json'),
  );
  return table(
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
}

export async function hourlySection(view: View): Promise<string> {
  const hours = hourlyPlayerCounts((await readStats(view.host.dataDir, Date.now() - 86_400_000)).snapshots);
  const peak = Math.max(1, ...hours);
  const rows = hours
    .map(
      (avg, hour) =>
        `<tr><td>${String(hour).padStart(2, '0')}:00</td><td><span class="bar" style="width:${Math.round((avg / peak) * 200)}px"></span> ${avg.toFixed(1)}</td></tr>`,
    )
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

/** A single self-contained read-only status page on the shared HTTP listener (needs HTTP_PORT). */
export default definePlugin<Options>({
  name: 'web-dashboard',
  description: 'One-page HTML dashboard: status, players, leaderboard, regulars, hourly load',
  defaults: { path: '/' },
  setup(ctx) {
    if (!ctx.host.httpPort) {
      ctx.log.warn('HTTP_PORT is not set; plugin is idle');
      return;
    }
    const web = acquireWebServer(ctx.host.httpPort, ctx.log, ctx.host.httpBind ?? '0.0.0.0');
    const unregister = web.register({
      method: 'GET',
      path: ctx.options.path,
      handler: async (_req, res) => {
        const name = ctx.snapshot()?.status.serverName ?? 'WARDOGS';
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30">
<title>${esc(name)}</title><style>${STYLE}</style></head><body>
${statusHeader(ctx)}
<h2>Players online</h2>${playersTable(ctx)}
<div class="grid"><div><h2>All-time leaderboard</h2>${await leaderboardSection(ctx)}</div><div><h2>Regulars</h2>${await regularsSection(ctx)}</div></div>
<h2>Average players by hour (last 24 h)</h2>${await hourlySection(ctx)}
<p class="muted">wardogs-plugins · refreshes every 30 s</p></body></html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      },
    });
    ctx.onStop(() => {
      unregister();
      web.release();
    });
    ctx.log.info(
      `dashboard at http://${ctx.host.httpBind ?? '0.0.0.0'}:${ctx.host.httpPort}${ctx.options.path}`,
    );
  },
});
