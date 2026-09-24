import fs from 'node:fs/promises';
import path from 'node:path';
import type { FactionScore, Player } from '../rcon/types.ts';

/** One `event: 'session'` line written by stats-logger when a player leaves. */
export interface SessionLine {
  t: number;
  event: 'session';
  steamId: string;
  name: string;
  sessionSeconds: number | null;
  /** Time the host saw the player on (lower bound when sessionSeconds is null). Older lines lack it. */
  observedSeconds?: number;
  kills: number;
  deaths: number;
}

/** One periodic snapshot line written by stats-logger. */
export interface SnapshotLine {
  t: number;
  map: string;
  matchSeconds?: number;
  players: Player[];
  factionScores: FactionScore[];
}

export interface PlayerTotals {
  steamId: string;
  name: string;
  minutes: number;
  kills: number;
  deaths: number;
  sessions: number;
}

/** Read every stats line at or after `sinceMs` (0 = everything). Bad lines are skipped. */
export async function readStats(
  dataDir: string,
  sinceMs: number,
): Promise<{ sessions: SessionLine[]; snapshots: SnapshotLine[] }> {
  const sessions: SessionLine[] = [];
  const snapshots: SnapshotLine[] = [];
  const directory = path.join(dataDir, 'stats');
  const day = new Date(Math.max(0, sinceMs)).toISOString().slice(0, 10);
  let files: string[] = [];
  try {
    files = await fs.readdir(directory);
  } catch {
    return { sessions, snapshots };
  }
  for (const file of files.filter((name) => name.endsWith('.jsonl') && name.slice(0, 10) >= day).sort()) {
    const content = await fs.readFile(path.join(directory, file), 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as { t?: unknown; event?: unknown };
        if (typeof value.t !== 'number' || value.t < sinceMs) continue;
        if (value.event === 'session') sessions.push(value as SessionLine);
        else snapshots.push(value as SnapshotLine);
      } catch {
        // A partial final line is harmless.
      }
    }
  }
  return { sessions, snapshots };
}

/** Average player count per local hour of day (24 entries; 0 where there were no snapshots). */
export function hourlyPlayerCounts(snapshots: SnapshotLine[]): number[] {
  const totals = Array<number>(24).fill(0);
  const counts = Array<number>(24).fill(0);
  for (const snapshot of snapshots) {
    const hour = new Date(snapshot.t).getHours();
    totals[hour]! += snapshot.players.length;
    counts[hour]! += 1;
  }
  return totals.map((total, hour) => (counts[hour] ? total / counts[hour]! : 0));
}

/** Totals per steamId across sessions. Kills/deaths are summed from each session's final numbers. */
export function playtimeBySteamId(sessions: SessionLine[]): Map<string, PlayerTotals> {
  const result = new Map<string, PlayerTotals>();
  for (const session of sessions) {
    const row = result.get(session.steamId) ?? {
      steamId: session.steamId,
      name: session.name,
      minutes: 0,
      kills: 0,
      deaths: 0,
      sessions: 0,
    };
    row.name = session.name;
    row.minutes += (session.sessionSeconds ?? session.observedSeconds ?? 0) / 60;
    row.kills += session.kills;
    row.deaths += session.deaths;
    row.sessions += 1;
    result.set(session.steamId, row);
  }
  return result;
}

/** Top players by total kills (one row per player, not per session). */
export function topByKills(sessions: SessionLine[], n: number): PlayerTotals[] {
  return [...playtimeBySteamId(sessions).values()]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.minutes - a.minutes)
    .slice(0, n);
}
