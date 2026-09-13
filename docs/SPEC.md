# wardogs-plugins — implementation spec

A **plugin host + CLI** for a WARDOGS dedicated server hosted on xREALM (or any approved host).
The game server exposes only an RCON HTTP API; there is no in-process mod/plugin API and the
hosting panel cannot run arbitrary code. So this project runs **off-box** (any VPS / home box /
container you control) and drives the server remotely over TLS.

This was the implementation contract the first version was built from (2026-09-12), kept as the design
reference. The recruiting plugins (`recruit-pitch`, `regulars`, `match-mvp`, `fill-server`, `event-announcer`)
were added afterwards on the same plugin API; their options are documented in the README and `plugins.example.json`.

## 0. Ground rules

- **TypeScript, ESM, zero runtime dependencies.** Node ≥ 20 for built output. Node ≥ 23.6 (dev box has 24) runs
  `.ts` directly via type stripping, so:
  - Use only _erasable_ TS syntax: no `enum`, no `namespace`, no parameter properties (`constructor(private x)`),
    no `import x = require()`. `tsconfig` enforces `erasableSyntaxOnly`.
  - Every relative import must include the `.ts` extension: `import { x } from './foo.ts'`. Type-only imports use
    `import type`. `tsc` rewrites these to `.js` for `dist/`.
- Networking via `node:http` / `node:https` (NOT `fetch`), so we can pass `ca` / `rejectUnauthorized` per client
  without touching global env.
- `strict` + `noUncheckedIndexedAccess` are on; code must typecheck with `npm run typecheck`.
- Tests use `node:test` + `node:assert/strict`, run with `npm test` (Node runs the `.ts` test files directly).
- Logs go to stdout as single lines: `2026-09-12T20:00:00.000Z INFO  [welcome] message`. No colors by default.
- Never log the RCON password.

## 1. The RCON HTTP API (what plugins can call)

Reference: https://wardogs.tech/rcon-reference · OpenAPI: https://wardogs.tech/openapi.json

- Base URL: `${scheme}://${host}:${port}` — `https` for any network-exposed listener (hosted servers), `http`
  only for a loopback listener. Default port 7776.
- Auth: `Authorization: Bearer <rcon-password>` on every request. One token, full access.
- JSON in/out (`Content-Type: application/json`) except `PUT /v1/config` and `POST /v1/config/validate`, which
  send `text/plain` bodies.
- Errors: non-2xx with body `{ "error": { "code": string, "message": string } }`. `PUT /v1/config` returns
  **412** with a `ConfigResult` body when `If-Match` revision is stale.
- Feature detection: `GET /v1/capabilities` → `{ routes: string[], config: { writable: boolean } }`. Route strings
  look like `"PATCH /v1/players/{id}"`. Not every server enables every route.
- Poll gently: the official panel refreshes every 3–5 s.

| Method | Path                              | Body                                                                      | Returns                     |
| ------ | --------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| GET    | /v1/status                        | —                                                                         | `Status`                    |
| GET    | /v1/players                       | —                                                                         | `Players`                   |
| GET    | /v1/capabilities                  | —                                                                         | `Capabilities`              |
| GET    | /v1/bans                          | —                                                                         | `Bans`                      |
| GET    | /v1/reserved-slots                | —                                                                         | `ReservedSlots`             |
| GET    | /v1/audit?limit=N                 | — (1–500, default 50)                                                     | `Audit`                     |
| GET    | /v1/config                        | —                                                                         | `ConfigDocument`            |
| GET    | /v1/rotation                      | —                                                                         | `Rotation`                  |
| GET    | /v1/catalog/maps                  | —                                                                         | Catalog                     |
| GET    | /v1/catalog/lightings             | —                                                                         | Catalog                     |
| GET    | /v1/catalog/experiences           | —                                                                         | Catalog                     |
| GET    | /v1/catalog/maps/{id}/experiences | —                                                                         | Catalog                     |
| GET    | /v1/catalog/maps/{id}/alternators | —                                                                         | Catalog                     |
| GET    | /v1/sponsor                       | —                                                                         | `Sponsor`                   |
| POST   | /v1/players/{steamId}/kick        | `{ reason }`                                                              | Ok                          |
| POST   | /v1/players/{steamId}/kill        | —                                                                         | Ok                          |
| POST   | /v1/players/{steamId}/message     | `{ message }`                                                             | Ok                          |
| PATCH  | /v1/players/{steamId}             | `{ faction }` (capability-gated)                                          | Ok                          |
| POST   | /v1/broadcast                     | `{ message }`                                                             | Ok                          |
| POST   | /v1/bans                          | `{ steamId, reason? }`                                                    | Ok                          |
| DELETE | /v1/bans/{steamId}                | —                                                                         | Ok                          |
| POST   | /v1/reserved-slots                | `{ steamId }`                                                             | Ok                          |
| DELETE | /v1/reserved-slots/{steamId}      | —                                                                         | Ok                          |
| POST   | /v1/match/map                     | `MapSelection`                                                            | Ok                          |
| POST   | /v1/match/end                     | —                                                                         | Ok                          |
| POST   | /v1/match/restart                 | —                                                                         | Ok                          |
| PUT    | /v1/world/lighting                | `{ lighting }`                                                            | Ok                          |
| POST   | /v1/rotation/entries              | `MapSelection`                                                            | Ok                          |
| DELETE | /v1/rotation/entries/{i}          | —                                                                         | Ok                          |
| POST   | /v1/rotation/entries/{i}/move     | `{ direction: "up"\|"down" }`                                             | Ok                          |
| POST   | /v1/rotation/save                 | —                                                                         | Ok                          |
| PATCH  | /v1/settings                      | `SettingsPatch`                                                           | Ok                          |
| POST   | /v1/config/validate               | text/plain config                                                         | `ConfigResult`              |
| PUT    | /v1/config                        | text/plain config; header `If-Match: "<rev>"`; query `force`, `fullApply` | `ConfigResult` (200 or 412) |
| PUT    | /v1/sponsor                       | `{ imageUrl }`                                                            | Ok                          |

Types for every response are in `src/rcon/types.ts` — use them, don't redefine.

## 2. Layout

```
src/
  index.ts                 entry: load config → RconClient → PluginHost.start(); SIGINT/SIGTERM → graceful stop
  cli.ts                   one-shot admin commands (section 6)
  config.ts                env + plugins.json loading (section 3)
  rcon/
    types.ts               (exists)
    client.ts              RconClient + RconError (section 4)
  host/
    logger.ts              createLogger(level, prefix)
    events.ts              Events map + Snapshot type (section 5.1)
    plugin.ts              Plugin / PluginContext interfaces, definePlugin() (section 5.2)
    store.ts               JSON file KV store per plugin (section 5.4)
    host.ts                PluginHost (section 5.3)
    registry.ts            map of plugin name → Plugin (all built-ins)
  plugins/
    welcome.ts  motd.ts  discord-relay.ts  ping-guard.ts  team-balance.ts
    stats-logger.ts  audit-tail.ts  empty-server.ts  ban-sync.ts  lighting-clock.ts
  test/
    mock-server.ts         in-process fake /v1 server (section 7)
    client.test.ts  host.test.ts  plugins.test.ts
deploy/
  wardogs-plugins.service  systemd unit
  Dockerfile  docker-compose.yml  install.sh
README.md
```

## 3. `src/config.ts`

```ts
export interface RconConfig {
  host;
  port;
  scheme: 'http' | 'https';
  password;
  tlsInsecure: boolean;
  caFile?: string;
  timeoutMs;
}
export interface HostConfig {
  pollMs;
  auditPollMs;
  dataDir;
  logLevel;
  pluginsFile;
  discordWebhookUrl?;
  steamApiKey?;
}
export interface PluginsFile {
  [pluginName: string]: { enabled?: boolean; [option: string]: unknown };
}
export function loadEnv(): void; // if RCON_HOST unset and ./.env exists → process.loadEnvFile('.env') in try/catch (Node ≥ 20.12); no-op otherwise
export function loadRconConfig(env = process.env): RconConfig; // throws a clear Error listing missing vars (RCON_HOST, RCON_PASSWORD)
export function loadHostConfig(env = process.env): HostConfig; // defaults per .env.example
export function loadPluginsFile(path: string): PluginsFile; // missing file → {} with a warn; invalid JSON → throw; strips "$comment"
```

Defaults: port 7776, scheme https, tlsInsecure false, timeoutMs 10000, pollMs 4000, auditPollMs 15000,
dataDir `./data`, logLevel info, pluginsFile `./plugins.json`. `RCON_TLS_INSECURE` truthy values: `1`, `true`, `yes`.

## 4. `src/rcon/client.ts`

```ts
export class RconError extends Error {
  status: number; code: string | undefined; body: unknown; method: string; path: string;
}
export class RconConflictError extends RconError { result: ConfigResult }   // 412 from PUT /v1/config

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;             // serialize, Content-Type: application/json
  text?: string;              // raw body, Content-Type: text/plain
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class RconClient {
  constructor(cfg: RconConfig, opts?: { logger?: Logger })
  readonly baseUrl: string
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T>
  // one typed method per endpoint, e.g.:
  status(): Promise<Status>; players(): Promise<Players>; capabilities(): Promise<Capabilities>;
  bans(); reservedSlots(); audit(limit?: number); config(); rotation();
  catalogMaps(); catalogLightings(); catalogExperiences(); mapExperiences(id); mapAlternators(id); sponsor();
  kick(steamId, reason?); kill(steamId); message(steamId, message); setFaction(steamId, faction); broadcast(message);
  ban(steamId, reason?); unban(steamId); addReservedSlot(steamId); removeReservedSlot(steamId);
  changeMap(sel: MapSelection); endMatch(); restartMatch(); setLighting(lighting);
  addRotationEntry(sel); removeRotationEntry(i); moveRotationEntry(i, 'up'|'down'); saveRotation();
  patchSettings(p: SettingsPatch); validateConfig(text); putConfig(text, { ifMatch?, force?, fullApply? }); setSponsor(imageUrl);
  hasRoute(caps: Capabilities, method: string, pathTemplate: string): boolean  // static helper; normalizes "{steamId}"/"{id}"/"{i}" → "{id}" before comparing, case-insensitive method
}
```

Behavior:

- Build the request with `node:https`/`node:http` per `scheme`. For https pass `rejectUnauthorized: !tlsInsecure`
  and `ca: fs.readFileSync(caFile)` when `caFile` set. Use a keep-alive `Agent` per client.
- Always set `Authorization: Bearer <password>`, `Accept: application/json`, `User-Agent: wardogs-plugins/0.1`.
- Path params must be `encodeURIComponent`-ed. Query built with `URLSearchParams`, skipping `undefined`.
- Parse response: if `content-type` includes `application/json` (or body starts with `{`/`[`), JSON.parse; else
  return raw text. 2xx → return parsed body. Non-2xx → throw `RconError` with `code`/`message` from
  `body.error` when present, else `HTTP <status>`. **Exception:** `PUT /v1/config` with 412 → throw
  `RconConflictError` carrying the parsed `ConfigResult`.
- Timeouts (`timeoutMs`) → destroy the request and throw `RconError` with `status: 0`, `code: 'TIMEOUT'`.
  Connection errors → `RconError` `status: 0`, `code: err.code ?? 'NETWORK'`.
- `putConfig` sends `If-Match: "<rev>"` (quoted) when `ifMatch` given, plus `force`/`fullApply` query only when true.
- Debug-log each request as `→ METHOD /path` and `← status ms` (never the token or bodies at info level).

## 5. Plugin host

### 5.1 `src/host/events.ts`

```ts
export interface Snapshot {
  at: number /* Date.now() */;
  status: Status;
  players: Player[];
}
export interface Events {
  tick: { snapshot: Snapshot; previous: Snapshot | null };
  'server.up': { snapshot: Snapshot; downForMs: number | null };
  'server.down': { error: Error }; // emitted once per outage, on the first failed poll after a success
  'player.join': { player: Player; snapshot: Snapshot };
  'player.leave': { player: Player; snapshot: Snapshot; sessionSeconds: number | null }; // player = last seen record
  'match.map': { from: Status; to: Status; snapshot: Snapshot }; // map, experiences (set-compare), or alternator changed
  'match.new': { snapshot: Snapshot; previous: Snapshot }; // matchSeconds decreased vs previous (restart / next match)
  'match.lighting': { from: string; to: string; snapshot: Snapshot };
  'score.changed': { from: FactionScore[]; to: FactionScore[]; snapshot: Snapshot }; // deep-compare factionScores arrays
  'audit.entry': { entry: AuditEntry };
}
export type EventName = keyof Events;
```

### 5.2 `src/host/plugin.ts`

```ts
export interface PluginContext<O = Record<string, unknown>> {
  readonly name: string;
  readonly rcon: RconClient;
  readonly log: Logger;
  readonly options: O; // defaults merged under plugins.json values
  readonly state: Store; // persisted KV for this plugin
  readonly capabilities: Capabilities;
  readonly host: HostConfig;
  on<E extends EventName>(event: E, handler: (payload: Events[E]) => void | Promise<void>): void;
  every(ms: number, fn: () => void | Promise<void>, opts?: { immediate?: boolean }): () => void; // cleared on teardown
  snapshot(): Snapshot | null; // latest successful poll
  hasRoute(method: string, pathTemplate: string): boolean;
}
export interface Plugin<O = Record<string, unknown>> {
  name: string;
  description: string;
  defaults?: Partial<O>;
  requires?: Array<[method: string, pathTemplate: string]>; // e.g. [['PATCH','/v1/players/{id}']]; missing → plugin skipped with a warn
  setup(ctx: PluginContext<O>): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
export function definePlugin<O>(p: Plugin<O>): Plugin<O>;
```

Handler errors are caught by the host and logged as `error [plugin] event=<name> <message>`; one failing plugin
never stops the host or other plugins. Handlers run sequentially per event in registration order.

### 5.3 `src/host/host.ts` — `PluginHost`

```ts
new PluginHost({ rcon, config: HostConfig, plugins: PluginsFile, registry: Record<string, Plugin>, logger })
start(): Promise<void>; stop(): Promise<void>; emit<E>(event, payload): Promise<void>   // emit is public for tests
```

`start()`:

1. `mkdir -p dataDir`.
2. `capabilities = await rcon.capabilities()`; on failure log error and retry every `pollMs` until it succeeds
   (the server may be booting). Log the route count.
3. For each `plugins[name]` with `enabled === true`: unknown name → warn and skip; `requires` not all satisfied →
   warn listing missing routes and skip; else build context (options = `{...defaults, ...fileOptions}` minus
   `enabled`), `await plugin.setup(ctx)`, log `enabled <name>`. If **no** plugin enabled, warn but keep running
   (CLI-only users may still want the process as a health probe).
4. Start the poll loop (`setTimeout` chain, not `setInterval`, so slow polls don't pile up).
5. If any plugin subscribed to `audit.entry`, start the audit loop.

Poll loop, each iteration:

- `Promise.all([rcon.status(), rcon.players()])`. On failure: if `up === true` (or first-ever poll) → emit
  `server.down`, set `up=false`, `downSince=now`. Log at warn (first) / debug (repeats). Continue.
- On success build `snapshot`. If `up === false` → emit `server.up` with `downForMs`, set `up=true`, and treat
  this as a **baseline**: set `previous = null` so no join/leave/map/score events fire for the gap.
- If `previous !== null`, diff and emit in this order: `match.new`, `match.map`, `match.lighting`,
  `score.changed`, `player.leave` (per player), `player.join` (per player). Then always `tick`.
- Track `joinedAt: Map<steamId, number>` for `sessionSeconds`; set on join and on baseline (baseline → `null`
  session when they leave, since we don't know when they joined). Also keep `lastSeen: Map<steamId, Player>`
  so `player.leave` carries the final kills/deaths.

Audit loop (every `auditPollMs`): `rcon.audit(100)`; entries are considered ordered newest-first OR oldest-first
(unknown) — so key each entry as `${timestampUtc}|${sessionId}|${event}|${detail}` and keep a `Set` of keys from the
last fetch; emit `audit.entry` for keys not in the previous set, in **chronological order** (sort by
`timestampUtc` ascending). On the very first fetch, seed the set without emitting.

`stop()`: stop loops, call `teardown` on each enabled plugin (errors logged, not thrown), flush all stores, resolve.

### 5.4 `src/host/store.ts`

```ts
export class Store {
  constructor(filePath: string, logger);
  load(): Promise<void>; // missing file → {}
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void; // marks dirty; debounced flush (500 ms)
  delete(key: string): void;
  flush(): Promise<void>; // atomic write: tmp file + rename
}
```

Per-plugin path: `${dataDir}/state/${pluginName}.json`.

### 5.5 `src/host/logger.ts`

```ts
export type LogLevel = 'debug'|'info'|'warn'|'error'
export interface Logger { debug(...); info(...); warn(...); error(...); child(prefix: string): Logger }
export function createLogger(level: LogLevel, prefix?: string): Logger
```

Format: `<ISO time> <LEVEL padded to 5> [<prefix>] <message>`; extra args are JSON-stringified (Errors → `message`).

## 6. Plugins (all in `src/plugins/`, registered in `src/host/registry.ts`)

Option names and defaults must match `plugins.example.json` exactly. Templates use `{name}`, `{server}`,
`{players}`, `{max}`, `{steamId}`, plus per-plugin extras; implement one shared `fill(template, vars)` helper in
`src/host/template.ts`.

1. **welcome** — on `player.join`, wait `delayMs` (default 6000) then `rcon.message(steamId, text)`. If
   `rememberPlayers` (default true) and `state` has seen this steamId → use `returningMessage` (if set), else
   `message`; then record the steamId + `firstSeen`. Skip (no error) if the player has already left by the time
   the delay elapses.
2. **motd** — `every(intervalMinutes*60_000)`: if latest snapshot has `players.current >= minPlayers`, broadcast
   the next message in `messages` (round-robin index kept in state). Empty `messages` → warn at setup, no timer.
3. **discord-relay** — `webhookUrl` option falls back to `host.discordWebhookUrl`; neither → warn + no-op. For
   each name in `events` (default all listed in the example), subscribe and POST a webhook JSON body
   `{ username: "WARDOGS", embeds: [{ title, description, color, timestamp }] }` via the same http helper
   pattern (write a tiny `postJson(url, body)` in `src/host/http.ts`). Also, when `scoreEveryMinutes > 0`, post a
   scoreboard embed on that interval while players ≥ 1 (faction name → score value if any numeric field exists on
   the row besides colorHex, else just names). Colors: up green, down red, map blue, join/leave grey, audit orange.
   Rate-limit: queue posts, min 1 s apart, drop with a warn if the queue exceeds 50.
4. **ping-guard** — on `tick`: for each player with `pingMs > maxPingMs`, increment a strike counter (else reset
   to 0). At `warnAfterPolls` strikes → DM `"Your ping ({ping} ms) is above the limit ({maxPingMs} ms). You'll be
kicked if it stays high."` (once). At `kickAfterPolls` → `rcon.kick(steamId, fill(kickReason))`, log, reset.
   Exempt: `exemptSteamIds`, and when `exemptReserved` fetch `/v1/reserved-slots` at setup and every 5 min.
5. **team-balance** — `requires: [['PATCH','/v1/players/{id}']]`. On `tick`: count players per faction
   (factions = names from `status.factionScores`; ignore players whose faction isn't listed). If
   `max - min >= threshold` and cooldown elapsed: broadcast `warnMessage` with `{a}`/`{b}` = `"<Faction> <n>"`
   for the larger/smaller side; if `autoMove`, pick the player on the larger team with the most recent `joinedAt`
   (host exposes it via `ctx.snapshot()`? — no: keep a local `joinedAt` map from `player.join`; fall back to the
   player with the fewest kills), `rcon.setFaction(steamId, smallerFaction)`, DM them why. Then set cooldown.
6. **stats-logger** — every `snapshotEveryPolls` ticks append one line to
   `${dataDir}/stats/${YYYY-MM-DD}.jsonl`: `{ t, map, matchSeconds, players: [{steamId,name,faction,kills,deaths,cash,pingMs}], factionScores }`.
   On `player.leave` append `{ t, event: 'session', steamId, name, sessionSeconds, kills, deaths }`. Use
   `fs.promises.appendFile`; mkdir once.
7. **audit-tail** — on `audit.entry` log at info `audit <event> by <peer>: <detail>`; if `toFile`, append the JSON
   line to `${dataDir}/audit.jsonl`.
8. **empty-server** — on `tick`: if `players.current === 0`, and `emptySince` unset → set it. If empty for
   `afterMinutes` and not yet `applied`: if `map` set → `rcon.changeMap({ map, experiences, lighting })`, else if
   only `lighting` set → `rcon.setLighting(lighting)`; mark `applied`. When `players.current > 0` → clear both.
9. **ban-sync** — `every(intervalMinutes*60_000, {immediate:true})`: load `source` (a `http(s)://` URL via the http
   helper, or a local file path) expecting `[{ "steamId": "…", "reason": "…" }]`. Diff against `rcon.bans()`:
   ban each missing id (`rcon.ban`). If `removeUnlisted`, unban ids present on the server but not in the source
   (only those whose `bannedBy` equals a configurable `managedBy` marker? — no; keep it simple and document that
   `removeUnlisted` removes _every_ unlisted ban). Log a one-line summary `+n −m`.
10. **lighting-clock** — `schedule` is `[{ from: "HH:MM", lighting }]`. At setup, fetch `catalogLightings()` and
    warn for any preset not found (best-effort: the catalog shape is loose — search the JSON text for the id).
    `every(60_000, {immediate:true})`: compute local time using `Intl.DateTimeFormat` with `host` TZ
    (`process.env.TZ` is already honored by Node; just use `new Date()` hours/minutes), find the latest `from`
    ≤ now (wrapping to the last entry before the first `from`), and if it differs from the last applied preset
    **and** from `snapshot.status.lighting`, call `rcon.setLighting`. Do nothing when the server is down.

## 7. CLI — `src/cli.ts`

`wd <command> [args] [--json]`. Loads env the same way as the host. Prints human tables by default, raw JSON
with `--json`. Exit code 1 on error with the `RconError` message on stderr. Commands:

```
wd status                         wd players                     wd caps
wd bans                           wd slots                       wd audit [limit]
wd rotation                       wd maps | lightings | experiences [map] | alternators <map>
wd config get [> file]            wd config validate <file>      wd config put <file> [--force] [--full-apply]
wd broadcast <message…>           wd dm <steamId> <message…>
wd kick <steamId> [reason…]       wd kill <steamId>              wd faction <steamId> <faction>
wd ban <steamId> [reason…]        wd unban <steamId>
wd slot add <steamId>             wd slot rm <steamId>
wd map <map> [--exp A+B] [--lighting X] [--alt Y]                wd lighting <preset>
wd end                            wd restart
wd rotation add <map> [--exp A+B] [--lighting X] [--alt Y]      wd rotation rm <i>
wd rotation move <i> up|down      wd rotation save
wd settings [--score-tick N] [--rotation on|off] [--mode ordered|random]
wd sponsor [imageUrl]
wd watch                          (poll status every POLL_MS and print a one-line summary; Ctrl-C to stop)
```

`config put` reads `GET /v1/config` first and sends its `revision` as `If-Match` unless `--force`. On 412 print the
conflict and exit 2. Tiny hand-rolled arg parser (`--key value`, `--flag`, `--key=value`); no library.

## 8. Tests — `src/test/`

`mock-server.ts`: `startMockServer(): Promise<{ url, port, state, close(), requests: Array<{method,path,headers,body}> }>`
— an `http` server that requires `Authorization: Bearer test-token` (401 otherwise) and serves: `/v1/status`,
`/v1/players`, `/v1/capabilities`, `/v1/audit`, `/v1/bans`, `/v1/reserved-slots`, `/v1/broadcast`,
`/v1/players/{id}/message`, `/v1/players/{id}/kick`, `PATCH /v1/players/{id}`, `/v1/world/lighting`,
`/v1/config` (GET returns revision `r1`; PUT returns 412 unless `If-Match: "r1"`), `/v1/catalog/lightings`.
`state` is a mutable object tests edit between polls. Unknown paths → 404 with the documented error body.

- `client.test.ts`: bearer header sent; 404 → `RconError` with status/code; 401 → `RconError`; `putConfig` stale
  revision → `RconConflictError` with `result.revision`; timeout → `code: 'TIMEOUT'` (use a route that sleeps).
- `host.test.ts`: with `pollMs: 30`: no `player.join` on the first snapshot; adding a player to `state` → exactly
  one `player.join`; removing → `player.leave` with `sessionSeconds` ≥ 0; changing `state.status.map` →
  `match.map`; lowering `matchSeconds` → `match.new`; closing the mock server → `server.down`; restarting it on
  the same port → `server.up` and no spurious join events; `audit.entry` emitted only for new entries and in
  chronological order.
- `plugins.test.ts`: `welcome` DMs a joining player with the filled template (use `delayMs: 10`);
  `ping-guard` warns then kicks after the configured strikes; `team-balance` is skipped when the PATCH route is
  absent from capabilities and moves a player when present with `autoMove: true`.

Tests must be deterministic and finish in < 10 s total. Always `await host.stop()` and `close()` in `finally`.

## 9. Deploy files

- `deploy/wardogs-plugins.service`: `[Service] Type=simple  User=wardogs  WorkingDirectory=/opt/wardogs-plugins
EnvironmentFile=/opt/wardogs-plugins/.env  ExecStart=/usr/bin/node dist/index.js  Restart=always  RestartSec=5`
  - `[Install] WantedBy=multi-user.target`.
- `deploy/install.sh`: idempotent; `npm ci --omit=dev`? — no: build needs devDeps, so `npm ci && npm run build`,
  then copy the unit, `systemctl daemon-reload`, `enable --now`. Comments explain each step.
- `Dockerfile`: `node:24-alpine`, copy package files, `npm ci`, copy src, `npm run build`, `CMD ["node","dist/index.js"]`,
  volume `/app/data`. `docker-compose.yml` with `env_file: .env`, `volumes: ./data:/app/data, ./plugins.json:/app/plugins.json:ro`,
  `restart: unless-stopped`.

## 10. README.md

Sections: What this is (and why it runs off-box — no plugin API on the game server, xREALM can't run scripts);
Quick start (clone → `cp .env.example .env` → fill from the xREALM panel → `cp plugins.example.json plugins.json`
→ `npm install` → `npm run wd -- status` → `npm run dev`); TLS (strict first; on `SELF_SIGNED_CERT_IN_CHAIN` /
`DEPTH_ZERO_SELF_SIGNED_CERT` either `RCON_TLS_INSECURE=1` or pin with
`openssl s_client -connect HOST:PORT -showcerts </dev/null 2>/dev/null | openssl x509 > rcon-ca.pem`);
Plugins table (name, what it does, key options, required route); Writing a plugin (a 15-line example using
`definePlugin`); CLI cheat-sheet; Hosting it (systemd, Docker, PM2 one-liner); Security note (the token is
full-access: keep `.env` 0600, never in a browser); Troubleshooting (capabilities missing a route, 401, timeouts).
