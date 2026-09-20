import type { AuditEntry } from '../rcon/types.ts';

/**
 * The server's audit log records every RCON connection, every successful auth and every HTTP call,
 * including this host's own polling (status + players every few seconds, five more per panel page).
 * Those are noise for a log tail or a Discord channel. Failed auths and every write (POST/PUT/PATCH/
 * DELETE: kicks, bans, map changes, config) are kept.
 */
export function isNoiseAudit(entry: Pick<AuditEntry, 'event' | 'detail'>): boolean {
  const event = entry.event.toUpperCase();
  if (event === 'ACCEPT' || event === 'AUTH_OK' || event === 'CLOSE' || event === 'DISCONNECT') return true;
  if (event === 'HTTP') return /^(GET|HEAD|OPTIONS)\b/i.test(entry.detail.trim());
  return false;
}
