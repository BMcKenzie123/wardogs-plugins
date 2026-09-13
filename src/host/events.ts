import type { AuditEntry, FactionScore, Player, Status } from '../rcon/types.ts';
export interface Snapshot {
  at: number;
  status: Status;
  players: Player[];
}
export interface Events {
  tick: { snapshot: Snapshot; previous: Snapshot | null };
  'server.up': { snapshot: Snapshot; downForMs: number | null };
  'server.down': { error: Error };
  'player.join': { player: Player; snapshot: Snapshot };
  'player.leave': { player: Player; snapshot: Snapshot; sessionSeconds: number | null };
  'match.map': { from: Status; to: Status; snapshot: Snapshot };
  'match.new': { snapshot: Snapshot; previous: Snapshot };
  'match.lighting': { from: string; to: string; snapshot: Snapshot };
  'score.changed': { from: FactionScore[]; to: FactionScore[]; snapshot: Snapshot };
  'audit.entry': { entry: AuditEntry };
}
export type EventName = keyof Events;
