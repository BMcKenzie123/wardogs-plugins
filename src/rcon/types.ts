/**
 * Typed shapes for the WARDOGS RCON HTTP API (/v1).
 * Source of truth: https://wardogs.tech/rcon-reference and https://wardogs.tech/openapi.json (v0.27, 2026-09-10).
 * Servers may include extra fields; these are the ones documented as reliable.
 */

// ---------- Generic ----------

export interface Ok {
  ok?: boolean;
  message?: string;
  [extra: string]: unknown;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
  [extra: string]: unknown;
}

// ---------- Match state ----------

export interface FactionScore {
  name: string;
  colorHex: string;
  /** Servers include the live score under a server-defined key (commonly `score`). Keep it open. */
  [extra: string]: unknown;
}

export interface Status {
  serverName: string;
  /** Map id, e.g. "Kavkazi". */
  map: string;
  experiences: string[];
  lighting: string;
  alternator: string;
  scoreTick: { current: number; min: number; max: number };
  /** Documented, but some builds (xREALM, 2026-09) omit both. */
  scoreCap?: number;
  matchSeconds?: number;
  players: { current: number; max: number };
  factionScores: FactionScore[];
  rotation: { nowIndex: number | null; nextIndex: number | null } | null;
  [extra: string]: unknown;
}

// ---------- Players ----------

export interface Player {
  name: string;
  /** SteamID64 as a string. */
  steamId: string;
  /** Server-defined faction name. Match to a factionScores row by name (colorHex is the stable key). */
  faction: string;
  kills: number;
  deaths: number;
  cash: number;
  pingMs: number;
  [extra: string]: unknown;
}

export interface Players {
  players: Player[];
}

// ---------- Meta ----------

export interface Capabilities {
  /** e.g. "GET /v1/status", "PATCH /v1/players/{id}" */
  routes: string[];
  config: { writable: boolean };
}

export interface AuditEntry {
  timestampUtc: string;
  peer: string;
  sessionId: string;
  event: string;
  detail: string;
}

export interface Audit {
  entries: AuditEntry[];
}

// ---------- Moderation ----------

export interface Ban {
  steamId: string;
  bannedAtUtc: string;
  bannedBy: string;
  reason: string;
}

export interface Bans {
  bans: Ban[];
}

export interface ReservedSlots {
  reservedSlots: string[];
}

// ---------- Rotation ----------

export interface RotationEntry {
  map: string;
  experiences: string[];
  lighting: string;
  zoneAlternator: string;
  /** "now" | "next" | other server-defined markers */
  status: string;
  denied: boolean;
}

export interface Rotation {
  enabled: boolean;
  /** "ordered" | "random" */
  mode: string;
  entries: RotationEntry[];
}

/** Body for POST /v1/match/map and POST /v1/rotation/entries. */
export interface MapSelection {
  map: string;
  experiences?: string[];
  lighting?: string;
  zoneAlternator?: string;
}

// ---------- Config ----------

export interface ConfigDocument {
  revision: string;
  writable: boolean;
  /** The ServerSettings.ini text. */
  text: string;
  sections: unknown[];
  warnings: unknown[];
}

export interface ConfigResult {
  ok: boolean;
  revision: string;
  error?: { code?: string; message?: string };
  outcomes?: unknown[];
  shadowed?: unknown[];
  stripped?: unknown[];
  errors?: unknown[];
  changed?: unknown[];
  /** Present on HTTP 412 (revision mismatch). */
  conflict?: unknown[];
  warnings?: unknown[];
  timingsMs?: Record<string, number> | null;
}

export interface SettingsPatch {
  scoreTick?: number;
  rotationEnabled?: boolean;
  /** "ordered" | "random" */
  rotationMode?: string;
}

// ---------- Catalog / Sponsor ----------

/** Catalog list; shape varies by endpoint (maps / lightings / experiences). Keep loose. */
export type Catalog = unknown;

export interface Sponsor {
  imageUrl: string;
}
