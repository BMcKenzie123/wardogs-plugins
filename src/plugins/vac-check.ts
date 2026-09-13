import { definePlugin } from '../host/plugin.ts';
import { SteamClient } from '../host/steam.ts';
import { postJson } from '../host/http.ts';

interface Options {
  action: 'flag' | 'kick';
  kickReason: string;
  /** Game bans (non-VAC) needed to trigger; VAC bans always trigger. */
  minGameBans: number;
  webhookUrl: string;
  /** Override the Steam Web API base URL (tests). Empty = the real API. */
  steamBaseUrl: string;
}

const RECHECK_MS = 6 * 3_600_000;

/** Flags (log + Discord) or kicks accounts with VAC or game bans. Needs STEAM_API_KEY. */
export default definePlugin<Options>({
  name: 'vac-check',
  description: 'Flags or kicks VAC / game-banned Steam accounts',
  defaults: {
    action: 'flag',
    kickReason: 'VAC/game-banned accounts are not allowed here',
    minGameBans: 1,
    webhookUrl: '',
    steamBaseUrl: '',
  },
  setup(ctx) {
    if (!ctx.host.steamApiKey) {
      ctx.log.warn('STEAM_API_KEY is not set; plugin is idle');
      return;
    }
    const steam = new SteamClient(
      ctx.host.steamApiKey,
      ctx.options.steamBaseUrl ? { baseUrl: ctx.options.steamBaseUrl } : {},
    );
    const webhook = ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '';
    const checkedAt = new Map<string, number>();

    ctx.on('tick', async ({ snapshot }) => {
      const now = Date.now();
      const due = snapshot.players.filter((p) => now - (checkedAt.get(p.steamId) ?? 0) > RECHECK_MS);
      if (!due.length) return;
      for (const p of due) checkedAt.set(p.steamId, now); // set first so a slow API call isn't repeated next tick
      const bans = await steam.bans(due.map((p) => p.steamId));
      for (const p of due) {
        const b = bans.get(p.steamId);
        if (!b || (!b.vacBanned && b.gameBans < Number(ctx.options.minGameBans))) continue;
        const why = `${b.vacBans} VAC ban(s), ${b.gameBans} game ban(s), last ${b.daysSinceLastBan} days ago`;
        if (ctx.options.action === 'kick') {
          await ctx.rcon.kick(p.steamId, ctx.options.kickReason);
          ctx.log.warn(`kicked ${p.name} (${p.steamId}): ${why}`);
        } else {
          ctx.log.warn(`flagged ${p.name} (${p.steamId}): ${why}`);
        }
        if (webhook)
          await postJson(webhook, {
            username: 'WARDOGS',
            content: `${ctx.options.action === 'kick' ? 'Kicked' : 'Flagged'} **${p.name}** (${p.steamId}): ${why}`,
          }).catch((e: unknown) => ctx.log.warn('discord post failed', e));
      }
    });
    ctx.log.info(`action=${ctx.options.action}, minGameBans=${ctx.options.minGameBans}`);
  },
});
