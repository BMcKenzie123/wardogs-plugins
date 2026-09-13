import fs from 'node:fs/promises';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
import { SteamClient } from '../host/steam.ts';

interface Options {
  refreshHours: number;
  /** Override the Steam Web API base URL (tests). Empty = the real API. */
  steamBaseUrl: string;
}

interface Profile {
  name: string;
  avatar: string;
  country: string | null;
  updatedAt: number;
}

/**
 * Resolves steamIds to public Steam profile names, avatars and countries and caches them in
 * data/profiles.json for other tools (the dashboard, Discord posts, your own scripts).
 */
export default definePlugin<Options>({
  name: 'steam-profiles',
  description: 'Caches Steam profile names, avatars and countries to data/profiles.json',
  defaults: { refreshHours: 24, steamBaseUrl: '' },
  setup(ctx) {
    if (!ctx.host.steamApiKey) {
      ctx.log.warn('STEAM_API_KEY is not set; plugin is idle');
      return;
    }
    const steam = new SteamClient(
      ctx.host.steamApiKey,
      ctx.options.steamBaseUrl ? { baseUrl: ctx.options.steamBaseUrl } : {},
    );
    const file = path.join(ctx.host.dataDir, 'profiles.json');
    let profiles: Record<string, Profile> | null = null;

    const load = async (): Promise<Record<string, Profile>> => {
      if (profiles) return profiles;
      try {
        profiles = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, Profile>;
      } catch {
        profiles = {};
      }
      return profiles;
    };

    const refresh = async (ids: string[]): Promise<void> => {
      const all = await load();
      const maxAge = Number(ctx.options.refreshHours) * 3_600_000;
      const stale = ids.filter((id) => !all[id] || Date.now() - all[id]!.updatedAt > maxAge);
      if (!stale.length) return;
      const summaries = await steam.summaries(stale);
      let changed = 0;
      for (const [id, summary] of summaries) {
        all[id] = {
          name: summary.name,
          avatar: summary.avatar,
          country: summary.country,
          updatedAt: Date.now(),
        };
        changed += 1;
      }
      if (changed) {
        await fs.mkdir(ctx.host.dataDir, { recursive: true });
        await fs.writeFile(file, JSON.stringify(all, null, 2));
        ctx.log.info(`resolved ${changed} Steam profile(s)`);
      }
    };

    // Every poll covers new joins and the baseline roster; the cache makes repeats free.
    ctx.on('tick', ({ snapshot }) => refresh(snapshot.players.map((p) => p.steamId)));
    ctx.log.info(`refreshing profiles older than ${ctx.options.refreshHours} h`);
  },
});
