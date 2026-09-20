import { createHash, randomBytes } from 'node:crypto';
import { authenticate, parseAdminUsers, type AdminUser } from '../host/admins.ts';
import type http from 'node:http';
import { acquireWebServer } from '../host/webserver.ts';
import { definePlugin } from '../host/plugin.ts';
import { sponsorUrlProblem } from '../host/sponsor.ts';
import { RconError } from '../rcon/client.ts';
import {
  STYLE,
  esc,
  hourlySection,
  leaderboardSection,
  regularsSection,
  statusHeader,
  table,
} from './web-dashboard.ts';

interface Options {
  /** Page path; the action endpoint is `${path}/action` (or `/action` when path is `/`). */
  path: string;
  /** Rows of audit log to show. */
  auditRows: number;
  /** Lines of recent host activity to show. */
  logLines: number;
}

/** Best-effort: pull ids/names out of a loosely shaped catalog response. */
export function namesFrom(catalog: unknown): string[] {
  const list = Array.isArray(catalog)
    ? catalog
    : catalog && typeof catalog === 'object'
      ? ((Object.values(catalog as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ??
        [])
      : [];
  return list
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return String(o.id ?? o.name ?? o.map ?? '');
      }
      return '';
    })
    .filter(Boolean);
}

/** `2026-09-20T17:38:45.610Z INFO  [host:welcome] msg` → coloured `17:38:45 INFO  [welcome] msg`. */
export function formatLogLine(line: string): string {
  const m = /^(\d{4}-\d\d-\d\dT)(\d\d:\d\d:\d\d)\.\d+Z (\w+)\s+(?:\[host(?::([^\]]+))?\] )?(.*)$/.exec(line);
  if (!m) return esc(line);
  const level = m[3]!;
  const who = m[4] ? `<span class="who">[${esc(m[4])}]</span> ` : '';
  const cls = level === 'WARN' ? 'warn' : level === 'ERROR' ? 'err' : '';
  return `<span class="${cls}">${m[2]} ${level.padEnd(5)}</span> ${who}${esc(m[5])}`;
}

/** Basic auth → admin name, or null. Verified pairs are cached per process so scrypt runs once per login. */
function makeAuthorizer(
  users: AdminUser[],
  shared: string | undefined,
): (req: http.IncomingMessage) => string | null {
  const cache = new Map<string, string>();
  return (req) => {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) return null;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const user = idx < 0 ? '' : decoded.slice(0, idx);
    const password = idx < 0 ? decoded : decoded.slice(idx + 1);
    const key = createHash('sha256').update(decoded).digest('hex');
    const hit = cache.get(key);
    if (hit) return hit;
    const name = authenticate(user, password, users, shared);
    if (name) cache.set(key, name);
    return name;
  };
}

function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin ?? req.headers.referer;
  if (!origin) return true; // plain form posts from old clients; the CSRF token still applies
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * The all-in-one page: the dashboard, every admin action the RCON API allows, and the automation
 * layer (plugin states with live enable/disable, recent activity). HTTP Basic auth (ADMIN_PASSWORD)
 * with a CSRF token on every form. Put it behind HTTPS or a VPN before exposing it: the password
 * guards a full-access token.
 */
export default definePlugin<Options>({
  name: 'admin-panel',
  description: 'Password-protected web admin: dashboard, player/server actions, plugin toggles, activity log',
  defaults: { path: '/admin', auditRows: 15, logLines: 40 },
  setup(ctx) {
    if (!ctx.host.httpPort) {
      ctx.log.warn('HTTP_PORT is not set; plugin is idle');
      return;
    }
    let users: AdminUser[] = [];
    try {
      users = parseAdminUsers(ctx.host.adminUsers);
    } catch (e) {
      ctx.log.warn(`ADMIN_USERS is invalid; plugin is idle: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const shared = ctx.host.adminPassword;
    if (!users.length && !(shared && shared.length >= 8)) {
      ctx.log.warn('no ADMIN_USERS and no ADMIN_PASSWORD (8+ chars); plugin is idle');
      return;
    }
    const authorized = makeAuthorizer(users, shared);
    const pagePath = ctx.options.path;
    const actionPath = pagePath === '/' ? '/action' : `${pagePath.replace(/\/$/, '')}/action`;
    const csrf = randomBytes(16).toString('hex');
    const web = acquireWebServer(ctx.host.httpPort, ctx.log, ctx.host.httpBind ?? '0.0.0.0');

    const deny = (res: http.ServerResponse): void => {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="wardogs-plugins admin"',
        'Content-Type': 'text/plain',
      });
      res.end('authentication required');
    };
    const redirect = (res: http.ServerResponse, msg: string): void => {
      res.writeHead(303, { Location: `${pagePath}?msg=${encodeURIComponent(msg)}` });
      res.end();
    };

    const page = async (req: http.IncomingMessage, who: string): Promise<string> => {
      const snap = ctx.snapshot();
      const status = snap?.status;
      const canFaction = ctx.hasRoute('PATCH', '/v1/players/{id}');
      const canReserve = ctx.hasRoute('POST', '/v1/reserved-slots');
      const canUnreserve = ctx.hasRoute('DELETE', '/v1/reserved-slots/{id}');
      const canSponsor = ctx.hasRoute('PUT', '/v1/sponsor');
      const msg = new URL(req.url ?? '/', 'http://x').searchParams.get('msg');
      const hidden = `<input type="hidden" name="_csrf" value="${csrf}">`;
      const form = (inner: string, cls = 'card'): string =>
        `<form class="${cls}" method="post" action="${esc(actionPath)}">${hidden}${inner}</form>`;

      let maps: string[] = [];
      let lightings: string[] = [];
      let auditHtml = '<p class="muted">unavailable</p>';
      let bansHtml = '<p class="muted">unavailable</p>';
      let slotsHtml = '<p class="muted">unavailable</p>';
      if (snap) {
        const [m, l, a, b, s] = await Promise.allSettled([
          ctx.rcon.catalogMaps(),
          ctx.rcon.catalogLightings(),
          ctx.rcon.audit(Number(ctx.options.auditRows)),
          ctx.rcon.bans(),
          ctx.rcon.reservedSlots(),
        ]);
        if (m.status === 'fulfilled') maps = namesFrom(m.value);
        if (l.status === 'fulfilled') lightings = namesFrom(l.value);
        if (a.status === 'fulfilled')
          auditHtml = table(
            ['When (UTC)', 'Event', 'By', 'Detail'],
            a.value.entries.map((e) => [
              e.timestampUtc.replace('T', ' ').slice(0, 19),
              e.event,
              e.peer,
              e.detail,
            ]),
          );
        if (b.status === 'fulfilled')
          bansHtml = b.value.bans.length
            ? `<table><thead><tr><th>SteamID</th><th>When</th><th>By</th><th>Reason</th><th></th></tr></thead><tbody>${b.value.bans
                .map(
                  (ban) =>
                    `<tr><td>${esc(ban.steamId)}</td><td>${esc(ban.bannedAtUtc.slice(0, 16).replace('T', ' '))}</td><td>${esc(ban.bannedBy)}</td><td>${esc(ban.reason)}</td><td>${form(`<input type="hidden" name="steamId" value="${esc(ban.steamId)}"><button class="soft" name="action" value="unban">Unban</button>`, 'inline')}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="muted">no bans</p>';
        if (s.status === 'fulfilled')
          slotsHtml = s.value.reservedSlots.length
            ? `<table><tbody>${s.value.reservedSlots
                .map(
                  (id) =>
                    `<tr><td>${esc(id)}</td><td>${canUnreserve ? form(`<input type="hidden" name="steamId" value="${esc(id)}"><button class="soft" name="action" value="unreserve">Remove</button>`, 'inline') : ''}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="muted">no reserved slots</p>';
      }
      const datalist = (id: string, values: string[]): string =>
        values.length
          ? `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`
          : '';
      const factions = status?.factionScores.map((f) => f.name) ?? [];

      const playerRows = (snap?.players ?? [])
        .map(
          (
            p,
          ) => `<tr><td><b>${esc(p.name)}</b><br><span class="tag">${esc(p.steamId)}</span></td><td>${esc(p.faction)}</td><td>${p.kills}/${p.deaths}</td><td>${p.cash}</td><td>${p.pingMs}</td>
<td>${form(
            `<input type="hidden" name="steamId" value="${esc(p.steamId)}"><input type="text" name="text" placeholder="message / reason">
<button name="action" value="dm">DM</button><button class="soft" name="action" value="kick">Kick</button><button class="soft" name="action" value="kill">Kill</button><button class="warn" name="action" value="ban">Ban</button>` +
              (canFaction
                ? `<select name="faction">${factions.map((f) => `<option${f === p.faction ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select><button class="soft" name="action" value="faction">Move</button>`
                : ''),
            'inline',
          )}</td></tr>`,
        )
        .join('');

      // Automation: every registered plugin, its state, and a toggle. The panel can't switch itself off.
      const pluginRows = ctx
        .plugins()
        .map((p) => {
          const toggle =
            p.name === ctx.name
              ? '<span class="muted">this page</span>'
              : form(
                  `<input type="hidden" name="name" value="${esc(p.name)}"><input type="hidden" name="enabled" value="${p.state === 'enabled' ? '0' : '1'}"><button class="${p.state === 'enabled' ? 'soft' : ''}" name="action" value="plugin">${p.state === 'enabled' ? 'Disable' : 'Enable'}</button>`,
                  'inline',
                );
          const note = p.note ? `<br><span class="muted">${esc(p.note)}</span>` : '';
          return `<tr><td><b>${esc(p.name)}</b></td><td><span class="pill ${p.state}">${p.state}</span>${note}</td><td>${esc(p.description)}</td><td>${toggle}</td></tr>`;
        })
        .join('');
      const enabledCount = ctx.plugins().filter((p) => p.state === 'enabled').length;
      const activity = ctx.recentLog(Number(ctx.options.logLines)).map(formatLogLine).join('\n');

      return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><title>Admin · ${esc(status?.serverName ?? 'WARDOGS')}</title><style>${STYLE}</style></head><body>
${statusHeader(ctx)}
${msg ? `<div class="flash">${esc(msg)}</div>` : ''}
<h2>Players online</h2>
<table><thead><tr><th>Player</th><th>Faction</th><th>K/D</th><th>Cash</th><th>Ping</th><th>Actions</th></tr></thead><tbody>${playerRows || '<tr><td colspan="6" class="muted">nobody on</td></tr>'}</tbody></table>
<h2>Server</h2>
<div class="grid">
${form(`<b>Broadcast</b><input type="text" name="text" placeholder="message to everyone" style="flex:1"><button name="action" value="broadcast">Send</button>`)}
${form(`<b>Change map</b><input type="text" name="map" list="maps" placeholder="map id" required><input type="text" name="experiences" placeholder="experiences (a+b)"><input type="text" name="lighting" list="lightings" placeholder="lighting"><button name="action" value="map">Change now</button>${datalist('maps', maps)}`)}
${form(`<b>Lighting</b><input type="text" name="lighting" list="lightings" placeholder="preset" required><button name="action" value="lighting">Set</button>${datalist('lightings', lightings)}`)}
${form(`<b>Match</b><button class="soft" name="action" value="restart">Restart</button><button class="warn" name="action" value="end" onclick="return confirm('End the current match?')">End match</button>`)}
${form(`<b>Ban by SteamID</b><input type="text" name="steamId" placeholder="7656119…" required><input type="text" name="text" placeholder="reason"><button class="warn" name="action" value="ban">Ban</button>`)}
${canReserve ? form(`<b>Reserved slot</b><input type="text" name="steamId" placeholder="7656119…" required><button name="action" value="reserve">Add</button>`) : ''}
${canSponsor ? form(`<b>Sponsor banner</b><input type="text" name="imageUrl" placeholder="https://i.ibb.co/…/banner.png (1024×256)" style="flex:1"><button name="action" value="sponsor">Set</button>`) : ''}
</div>
<h2>Automation</h2> <span class="muted">${enabledCount} of ${ctx.plugins().length} plugins running · toggles take effect immediately and are saved to ${esc(ctx.host.pluginsFile)}</span>
<table><thead><tr><th>Plugin</th><th>State</th><th>What it does</th><th></th></tr></thead><tbody>${pluginRows}</tbody></table>
<h2>Recent activity</h2>
<pre class="log">${activity || '<span class="muted">nothing logged yet</span>'}</pre>
<div class="grid"><div><h2>Bans</h2>${bansHtml}</div><div><h2>Reserved slots</h2>${slotsHtml}</div></div>
<h2>Audit log</h2>${auditHtml}
<div class="grid"><div><h2>All-time leaderboard</h2>${await leaderboardSection(ctx)}</div><div><h2>Regulars</h2>${await regularsSection(ctx)}</div></div>
<h2>Average players by hour (last 24 h)</h2>${await hourlySection(ctx)}
<p class="muted">wardogs-plugins admin · signed in as <b>${esc(who)}</b> · ${users.length ? `${users.length} named admin(s)` : 'shared password'} · ${canFaction ? 'faction moves enabled' : 'faction moves not supported by this server'} · auto-refreshes when idle</p>
<script>setTimeout(function(){var a=document.activeElement;if(!a||!/INPUT|TEXTAREA|SELECT/.test(a.tagName))location.replace(location.pathname)},30000)</script>
</body></html>`;
    };

    const act = async (fields: URLSearchParams): Promise<string> => {
      const action = fields.get('action') ?? '';
      const steamId = (fields.get('steamId') ?? '').trim();
      const text = (fields.get('text') ?? '').trim();
      const who = steamId
        ? ` ${ctx.snapshot()?.players.find((p) => p.steamId === steamId)?.name ?? steamId}`
        : '';
      switch (action) {
        case 'broadcast':
          if (!text) return 'Nothing to broadcast.';
          await ctx.rcon.broadcast(text);
          return 'Broadcast sent.';
        case 'dm':
          if (!text) return 'Type a message first.';
          await ctx.rcon.message(steamId, text);
          return `DM sent to${who}.`;
        case 'kick':
          await ctx.rcon.kick(steamId, text || undefined);
          return `Kicked${who}.`;
        case 'kill':
          await ctx.rcon.kill(steamId);
          return `Killed${who}.`;
        case 'ban':
          await ctx.rcon.ban(steamId, text || undefined);
          return `Banned${who}.`;
        case 'unban':
          await ctx.rcon.unban(steamId);
          return `Unbanned ${steamId}.`;
        case 'faction': {
          const faction = (fields.get('faction') ?? '').trim();
          await ctx.rcon.setFaction(steamId, faction);
          return `Moved${who} to ${faction}.`;
        }
        case 'reserve':
          if (!ctx.hasRoute('POST', '/v1/reserved-slots'))
            return 'This server build does not expose reserved-slot changes over RCON.';
          await ctx.rcon.addReservedSlot(steamId);
          return `Reserved slot added for ${steamId}.`;
        case 'unreserve':
          if (!ctx.hasRoute('DELETE', '/v1/reserved-slots/{id}'))
            return 'This server build does not expose reserved-slot changes over RCON.';
          await ctx.rcon.removeReservedSlot(steamId);
          return `Reserved slot removed for ${steamId}.`;
        case 'map': {
          const map = (fields.get('map') ?? '').trim();
          const experiences = (fields.get('experiences') ?? '')
            .split('+')
            .map((s) => s.trim())
            .filter(Boolean);
          const lighting = (fields.get('lighting') ?? '').trim();
          await ctx.rcon.changeMap({
            map,
            ...(experiences.length ? { experiences } : {}),
            ...(lighting ? { lighting } : {}),
          });
          return `Changing map to ${map}.`;
        }
        case 'lighting': {
          const lighting = (fields.get('lighting') ?? '').trim();
          await ctx.rcon.setLighting(lighting);
          return `Lighting set to ${lighting}.`;
        }
        case 'end':
          await ctx.rcon.endMatch();
          return 'Match ended.';
        case 'restart':
          await ctx.rcon.restartMatch();
          return 'Match restarted.';
        case 'sponsor': {
          const imageUrl = (fields.get('imageUrl') ?? '').trim();
          if (!ctx.hasRoute('PUT', '/v1/sponsor'))
            return 'This server build does not expose the sponsor banner over RCON; set ServerImageURL in the config instead.';
          const problem = sponsorUrlProblem(imageUrl);
          if (problem) return problem;
          await ctx.rcon.setSponsor(imageUrl);
          return 'Sponsor banner updated.';
        }
        case 'plugin': {
          const name = (fields.get('name') ?? '').trim();
          const on = fields.get('enabled') === '1';
          if (name === ctx.name && !on) return 'Refusing to disable the admin panel from itself.';
          await ctx.setPluginEnabled(name, on);
          return `${on ? 'Enabled' : 'Disabled'} ${name}.`;
        }
        default:
          return `Unknown action "${action}".`;
      }
    };

    const unregisterGet = web.register({
      method: 'GET',
      path: pagePath,
      handler: async (req, res) => {
        const who = authorized(req);
        if (!who) return deny(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(await page(req, who));
      },
    });
    const unregisterPost = web.register({
      method: 'POST',
      path: actionPath,
      handler: async (req, res, body) => {
        const who = authorized(req);
        if (!who) return deny(res);
        const fields = new URLSearchParams(body);
        if (fields.get('_csrf') !== csrf || !sameOrigin(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('bad request token');
          return;
        }
        try {
          const result = await act(fields);
          ctx.log.info(`admin ${fields.get('action')} by ${who} → ${result}`);
          redirect(res, result);
        } catch (e) {
          const message =
            e instanceof RconError
              ? `${e.status || e.code}: ${e.message}`
              : e instanceof Error
                ? e.message
                : String(e);
          ctx.log.warn(`admin ${fields.get('action')} by ${who} failed: ${message}`);
          redirect(res, `Failed: ${message}`);
        }
      },
    });
    ctx.onStop(() => {
      unregisterGet();
      unregisterPost();
      web.release();
    });
    ctx.log.info(
      `admin panel at http://${ctx.host.httpBind ?? '0.0.0.0'}:${ctx.host.httpPort}${pagePath} (Basic auth: ${users.map((u) => u.name).join(', ') || 'shared password'})`,
    );
  },
});
