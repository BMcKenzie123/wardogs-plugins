import { definePlugin } from '../host/plugin.ts';
import { SteamClient } from '../host/steam.ts';

interface Options {
  minAccountDays: number;
  action: 'flag' | 'kick';
  /** Private profiles hide the creation date; kick them too when true. */
  kickUnknown: boolean;
  kickReason: string;
  /** Override the Steam Web API base URL (tests). Empty = the real API. */
  steamBaseUrl: string;
}

const RECHECK_MS = 6 * 3_600_000;

/** Flags or kicks Steam accounts younger than N days, a cheap filter for throwaway cheater accounts. */
export default definePlugin<Options>({
  name: 'new-account-gate',
  description: 'Flags or kicks Steam accounts younger than N days',
  defaults: {
    minAccountDays: 30,
    action: 'flag',
    kickUnknown: false,
    kickReason: 'Steam account too new for this server',
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
    const checkedAt = new Map<string, number>();
    const minMs = Number(ctx.options.minAccountDays) * 86_400_000;

    ctx.on('tick', async ({ snapshot }) => {
      const now = Date.now();
      const due = snapshot.players.filter((p) => now - (checkedAt.get(p.steamId) ?? 0) > RECHECK_MS);
      if (!due.length) return;
      for (const p of due) checkedAt.set(p.steamId, now);
      const summaries = await steam.summaries(due.map((p) => p.steamId));
      for (const p of due) {
        const created = summaries.get(p.steamId)?.createdAt ?? null;
        const tooNew = created === null ? ctx.options.kickUnknown : now - created < minMs;
        if (!tooNew) continue;
        const age =
          created === null
            ? 'unknown age (private profile)'
            : `${Math.floor((now - created) / 86_400_000)} days old`;
        if (ctx.options.action === 'kick') {
          await ctx.rcon.kick(p.steamId, ctx.options.kickReason);
          ctx.log.warn(`kicked ${p.name} (${p.steamId}): account ${age}`);
        } else {
          ctx.log.warn(`flagged ${p.name} (${p.steamId}): account ${age}`);
        }
      }
    });
    ctx.log.info(`minimum account age ${ctx.options.minAccountDays} days, action=${ctx.options.action}`);
  },
});
