import { definePlugin } from '../host/plugin.ts';
import { fill } from '../host/template.ts';
import { postJson } from '../host/http.ts';

interface Options {
  /** Rally when the player count is below this. */
  belowPlayers: number;
  /** Don't rally again for this long. Persisted, so a restart doesn't re-post. */
  cooldownMinutes: number;
  webhookUrl: string;
  /** Discord message. Vars: {server} {players} {max} {free} {map}. */
  message: string;
  /** Appended on its own line to the Discord message, e.g. how to find the server. */
  connectInfo: string;
  /** ["22:00", "08:00"] — no rallies between these local times (may wrap midnight). [] = always. */
  quietHours: string[];
  /** Optional in-game broadcast to the people already on (only sent when someone is on). Empty = off. */
  broadcast: string;
}

export function hhmm(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** True when `now` (HH:MM) falls inside [from, to). Handles ranges that wrap past midnight. */
export function inQuietHours(now: string, range: string[]): boolean {
  const from = range[0];
  const to = range[1];
  if (!from || !to) return false;
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/**
 * Pulls people *onto* the server: when the population is low, post a rally to Discord (and
 * optionally nudge the people already playing to invite friends). Rate-limited and quiet at night.
 */
export default definePlugin<Options>({
  name: 'fill-server',
  description: 'Rallies your Discord (and current players) when the server is under-populated',
  defaults: {
    belowPlayers: 8,
    cooldownMinutes: 60,
    webhookUrl: '',
    message:
      'Only **{players}/{max}** on **{server}** right now (map: {map}). {free} slots free — come fill it!',
    connectInfo: '',
    quietHours: [],
    broadcast: '',
  },
  setup(ctx) {
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '';
    if (!url && !ctx.options.broadcast) {
      ctx.log.warn('no webhook URL (webhookUrl / DISCORD_WEBHOOK_URL) and no broadcast text; plugin is idle');
      return;
    }
    const quiet = Array.isArray(ctx.options.quietHours) ? ctx.options.quietHours.map(String) : [];

    ctx.on('tick', async ({ snapshot }) => {
      const cur = snapshot.status.players.current;
      if (cur >= Number(ctx.options.belowPlayers)) return;
      if (inQuietHours(hhmm(), quiet)) return;
      const now = snapshot.at;
      const last = ctx.state.get<number>('lastRally', 0);
      if (now - last < Number(ctx.options.cooldownMinutes) * 60_000) return;

      const vars = {
        server: snapshot.status.serverName,
        players: cur,
        max: snapshot.status.players.max,
        free: snapshot.status.players.max - cur,
        map: snapshot.status.map,
      };
      if (url) {
        const content =
          fill(ctx.options.message, vars) + (ctx.options.connectInfo ? `\n${ctx.options.connectInfo}` : '');
        await postJson(url, { username: 'WARDOGS', content });
      }
      if (ctx.options.broadcast && cur > 0) await ctx.rcon.broadcast(fill(ctx.options.broadcast, vars));
      ctx.state.set('lastRally', now);
      ctx.log.info(`rallied at ${cur}/${vars.max} players`);
    });
  },
});
