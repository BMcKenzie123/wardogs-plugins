import type { RconClient } from '../rcon/client.ts';

/** Where a player-specific message goes: to everyone, or as a private message to that player. */
export type SayMode = 'broadcast' | 'dm';

/** The values the admin panel offers in the dropdown. */
export const SAY_MODES: readonly SayMode[] = ['broadcast', 'dm'];

/** Reads a mode option leniently: "dm", "whisper" and "private" whisper; "broadcast", "all" and "public" shout. */
export function sayMode(value: unknown, fallback: SayMode = 'broadcast'): SayMode {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (v === 'dm' || v === 'whisper' || v === 'private') return 'dm';
  if (v === 'broadcast' || v === 'all' || v === 'public') return 'broadcast';
  return fallback;
}

export async function say(rcon: RconClient, mode: SayMode, steamId: string, text: string): Promise<void> {
  if (mode === 'dm') await rcon.message(steamId, text);
  else await rcon.broadcast(text);
}
