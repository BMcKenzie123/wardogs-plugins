import fs from 'node:fs/promises';
import path from 'node:path';
import { RconError } from '../rcon/client.ts';

/** One temporary ban: the server holds the ban itself; this record says when to lift it. */
export interface TempBan {
  steamId: string;
  reason: string;
  expiresAt: string;
  /** Admin who placed it (panel bans); absent for CLI bans. */
  by?: string;
}

export const tempBansFile = (dataDir: string): string => path.join(dataDir, 'temp-bans.json');

/** "30m", "12h", "3d", "2w" → milliseconds; null when malformed or zero. */
export function durationMs(value: string): number | null {
  const m = /^(\d+)\s*(m|h|d|w)$/i.exec(value.trim());
  if (!m) return null;
  const units: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const ms = Number(m[1]) * units[m[2]!.toLowerCase()]!;
  return ms > 0 ? ms : null;
}

export async function readTempBans(dataDir: string): Promise<TempBan[]> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(tempBansFile(dataDir), 'utf8'));
    return Array.isArray(value)
      ? (value as TempBan[]).filter(
          (b) => b && typeof b.steamId === 'string' && typeof b.expiresAt === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

export async function writeTempBans(dataDir: string, bans: TempBan[]): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tempBansFile(dataDir), JSON.stringify(bans, null, 2));
}

/** Record (or refresh) a temp ban; one record per steamId. */
export async function recordTempBan(dataDir: string, ban: TempBan): Promise<void> {
  const bans = (await readTempBans(dataDir)).filter((b) => b.steamId !== ban.steamId);
  bans.push(ban);
  await writeTempBans(dataDir, bans);
}

/** Drop the record for a steamId (after a manual unban or a permanent ban). True when one was removed. */
export async function forgetTempBan(dataDir: string, steamId: string): Promise<boolean> {
  const bans = await readTempBans(dataDir);
  const kept = bans.filter((b) => b.steamId !== steamId);
  if (kept.length === bans.length) return false;
  await writeTempBans(dataDir, kept);
  return true;
}

/**
 * Lift every expired temp ban now. Returns the ids lifted. A ban the server no longer has (404) counts as
 * lifted; any other failure keeps the record so the next sweep retries it.
 */
export async function sweepExpiredTempBans(
  dataDir: string,
  rcon: { unban(steamId: string): Promise<unknown> },
  log?: { warn(message: string, error?: unknown): void },
): Promise<string[]> {
  const bans = await readTempBans(dataDir);
  if (!bans.length) return [];
  const now = Date.now();
  const lifted: string[] = [];
  const keep: TempBan[] = [];
  for (const ban of bans) {
    if (Date.parse(ban.expiresAt) > now) {
      keep.push(ban);
      continue;
    }
    try {
      await rcon.unban(ban.steamId);
      lifted.push(ban.steamId);
    } catch (e) {
      if (e instanceof RconError && e.status === 404) lifted.push(ban.steamId);
      else {
        keep.push(ban);
        log?.warn(`could not lift temp ban ${ban.steamId}; will retry`, e);
      }
    }
  }
  if (lifted.length) await writeTempBans(dataDir, keep);
  return lifted;
}

/** "lifts in 3 d" / "lifts in 40 min" / "expired, lifts at next cleanup". */
export function describeExpiry(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return 'temp';
  if (ms <= 0) return 'expired, lifts at next cleanup';
  const hours = ms / 3_600_000;
  if (hours < 1) return `lifts in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (Math.round(hours) < 48) return `lifts in ${Math.round(hours)} h`;
  return `lifts in ${Math.round(hours / 24)} d`;
}
