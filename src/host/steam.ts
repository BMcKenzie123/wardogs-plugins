import { requestJson } from './http.ts';

export interface SteamSummary {
  steamId: string;
  name: string;
  avatar: string;
  createdAt: number | null;
  country: string | null;
}

export interface SteamBans {
  steamId: string;
  vacBanned: boolean;
  vacBans: number;
  gameBans: number;
  daysSinceLastBan: number;
}

interface Cache<T> {
  at: number;
  value: T;
}

export class SteamClient {
  private key: string;
  private ttlMs: number;
  private baseUrl: string;
  private summaryCache = new Map<string, Cache<SteamSummary>>();
  private banCache = new Map<string, Cache<SteamBans>>();

  constructor(apiKey: string, opts: { ttlMs?: number; baseUrl?: string } = {}) {
    this.key = apiKey;
    this.ttlMs = opts.ttlMs ?? 6 * 60 * 60_000;
    this.baseUrl = opts.baseUrl ?? 'https://api.steampowered.com';
  }

  async summaries(ids: string[]): Promise<Map<string, SteamSummary>> {
    const now = Date.now();
    const result = new Map<string, SteamSummary>();
    const missing = ids.filter((id) => {
      const cached = this.summaryCache.get(id);
      if (!cached || now - cached.at >= this.ttlMs) return true;
      result.set(id, cached.value);
      return false;
    });
    for (const batch of chunks(missing, 100)) {
      const url = `${this.baseUrl}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(this.key)}&steamids=${encodeURIComponent(batch.join(','))}`;
      const data = await requestJson<{ response?: { players?: Array<Record<string, unknown>> } }>('GET', url);
      for (const player of data.response?.players ?? []) {
        const steamId = String(player.steamid ?? '');
        if (!steamId) continue;
        const value: SteamSummary = {
          steamId,
          name: String(player.personaname ?? ''),
          avatar: String(player.avatarfull ?? player.avatar ?? ''),
          createdAt: typeof player.timecreated === 'number' ? player.timecreated * 1000 : null,
          country: typeof player.loccountrycode === 'string' ? player.loccountrycode : null,
        };
        this.summaryCache.set(steamId, { at: now, value });
        result.set(steamId, value);
      }
    }
    return result;
  }

  /** Whatever is already cached and fresh for these ids; no network call. */
  cachedSummaries(ids: string[]): Map<string, SteamSummary> {
    const now = Date.now();
    const result = new Map<string, SteamSummary>();
    for (const id of ids) {
      const cached = this.summaryCache.get(id);
      if (cached && now - cached.at < this.ttlMs) result.set(id, cached.value);
    }
    return result;
  }

  async bans(ids: string[]): Promise<Map<string, SteamBans>> {
    const now = Date.now();
    const result = new Map<string, SteamBans>();
    const missing = ids.filter((id) => {
      const cached = this.banCache.get(id);
      if (!cached || now - cached.at >= this.ttlMs) return true;
      result.set(id, cached.value);
      return false;
    });
    for (const batch of chunks(missing, 100)) {
      const url = `${this.baseUrl}/ISteamUser/GetPlayerBans/v1/?key=${encodeURIComponent(this.key)}&steamids=${encodeURIComponent(batch.join(','))}`;
      const data = await requestJson<{ players?: Array<Record<string, unknown>> }>('GET', url);
      for (const player of data.players ?? []) {
        const steamId = String(player.SteamId ?? '');
        if (!steamId) continue;
        const value: SteamBans = {
          steamId,
          vacBanned: player.VACBanned === true,
          vacBans: Number(player.NumberOfVACBans ?? 0),
          gameBans: Number(player.NumberOfGameBans ?? 0),
          daysSinceLastBan: Number(player.DaysSinceLastBan ?? 0),
        };
        this.banCache.set(steamId, { at: now, value });
        result.set(steamId, value);
      }
    }
    return result;
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
