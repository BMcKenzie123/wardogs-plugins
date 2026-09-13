# Spec 2 — the remaining 27 plugins

Adds the plugins from the options menu to the existing host. Read `docs/SPEC.md` (host/plugin API) and skim
`src/host/*.ts`, `src/plugins/regulars.ts`, `src/plugins/fill-server.ts`, `src/test/mock-server.ts`,
`src/test/recruiting.test.ts` first: **match their style exactly**.

## Formatting rules (non-negotiable)

- Normal multi-line TypeScript, one statement per line, Prettier style (`printWidth` 110, single quotes, trailing
  commas). **Never** put a whole file, function, or object on one line. Run `npx prettier --write "src/**/*.ts"`
  before finishing.
- Erasable-only TS syntax, `.ts` extensions on relative imports, `import type` for types, zero runtime deps,
  `node:http`/`node:https` not `fetch`. `npm run check` must pass (typecheck + tests).
- Every plugin: `definePlugin<Options>({...})` with an `interface Options`, `defaults` for **every** option (matching
  `plugins.example.json`), a JSDoc comment on the export, `ctx.log.info` on setup summarising config, and no
  unhandled promise rejections (wrap `setTimeout` bodies in `.catch`). Handlers may `await` freely — the host
  catches errors.
- Plugins that need a credential they don't have (`STEAM_API_KEY`, `DISCORD_BOT_TOKEN`, a webhook) log **one**
  `warn` at setup and stay idle. Never throw from `setup` for a missing credential.
- Persist anything that must survive a restart in `ctx.state` (per-plugin JSON) — cooldowns, "already sent" sets,
  visit counts. Prune sets so state files don't grow forever.

## Shared additions (do these first)

### `src/config.ts`

Add to `HostConfig`: `discordBotToken?: string` (env `DISCORD_BOT_TOKEN`), `httpPort?: number` (env `HTTP_PORT`,
optional, no default). Add both to `.env.example` with comments.

### `src/host/http.ts`

Generalise: `export function requestJson<T>(method, url, opts?: { headers?, body?: unknown, timeoutMs? }): Promise<T>`
(JSON body → `application/json`; non-2xx → throw `Error(\`HTTP ${status} ${method} ${url}: ${bodyText.slice(0,200)}\`)`;
empty body → `undefined`). Keep `postJson(url, body, headers?)`and`getText(url, headers?)` working (implement on top).
Follow one redirect (301/302/307/308) for GET.

### `src/host/steam.ts` — `SteamClient`

```ts
new SteamClient(apiKey: string, opts?: { ttlMs?: number /* 6h */ })
summaries(ids: string[]): Promise<Map<string, SteamSummary>>   // ISteamUser/GetPlayerSummaries/v2, batches of 100, cached
bans(ids: string[]): Promise<Map<string, SteamBans>>           // ISteamUser/GetPlayerBans/v1, batches of 100, cached
interface SteamSummary { steamId; name: string; avatar: string; createdAt: number | null /* timecreated*1000, null if private */; country: string | null }
interface SteamBans { steamId; vacBanned: boolean; vacBans: number; gameBans: number; daysSinceLastBan: number }
```

Base URL `https://api.steampowered.com`. Missing ids in the response → not in the map. Errors propagate.

### `src/host/stats.ts` — readers for what `stats-logger` writes

```ts
export interface SessionLine {
  t: number;
  event: 'session';
  steamId;
  name;
  sessionSeconds: number | null;
  kills;
  deaths;
}
export interface SnapshotLine {
  t: number;
  map;
  matchSeconds;
  players: Player[];
  factionScores;
}
export async function readStats(
  dataDir,
  sinceMs: number,
): Promise<{ sessions: SessionLine[]; snapshots: SnapshotLine[] }>;
```

Reads `${dataDir}/stats/*.jsonl` whose filename date is ≥ the day of `sinceMs`, parses each line (skip bad lines),
filters `t >= sinceMs`. Export helpers: `hourlyPlayerCounts(snapshots): number[24]` (average `players.length` per
local hour), `topByKills(sessions, n)`, `playtimeBySteamId(sessions): Map<string, { name, minutes, kills, deaths, sessions }>`.

### `src/host/webserver.ts` — one shared HTTP listener for plugins

```ts
export interface Route {
  method: 'GET';
  path: string;
  handler: (req, res) => void | Promise<void>;
}
export function acquireWebServer(
  port: number,
  logger: Logger,
): { register(route: Route): () => void; release(): void };
```

Module singleton: the first `acquire` starts `http.createServer` on `127.0.0.1`? No — bind `0.0.0.0` (it's for
Grafana / uptime monitors on other boxes), log the URL. `release()` decrements a refcount; at zero, `server.close()`
(with `closeAllConnections`). Unknown path → 404 text. Handler errors → 500 + log.

### `src/test/mock-server.ts`

Extend so every endpoint the new plugins call exists: `PATCH /v1/settings` (stores `scoreTick`, `rotationEnabled`,
`rotationMode` on state), `GET/PUT /v1/sponsor` (state.sponsorUrl), `GET /v1/rotation` (state.rotation:
`{ enabled, mode, entries }`), `POST /v1/rotation/entries`, `DELETE /v1/rotation/entries/{i}`,
`POST /v1/rotation/entries/{i}/move`, `POST /v1/rotation/save` (sets state.rotationSaved = true),
`POST /v1/match/end` (sets state.matchSeconds = 0, state.matchEnded++), `POST /v1/match/restart`,
`POST /v1/reserved-slots`, `DELETE /v1/reserved-slots/{id}`, `GET /v1/catalog/maps` (`{ maps: state.maps }`),
`GET /v1/config` should return `state.configText` and `state.configRevision`. Keep every existing behaviour.
Also export `startWebhookSink()` (move it out of `recruiting.test.ts` and reuse it) and a
`startSteamMock()` that serves `GetPlayerSummaries/v2` and `GetPlayerBans/v1` from a mutable `state` map, so
Steam-dependent plugins can be tested by pointing `SteamClient` at it (add an optional `baseUrl` to SteamClient).
Also `startDiscordMock()` serving `GET /api/v10/channels/{id}/messages` from a mutable message array.

## The plugins (names, options with defaults, behaviour, test)

Register all of them in `src/host/registry.ts`, add each to `plugins.example.json` (**disabled** unless noted, with
every option present) and to the README plugin table (one row each, same columns). Tests go in
`src/test/plugins-2.test.ts` and `src/test/plugins-3.test.ts` (split roughly in half) using the same `makeHost`
pattern; every plugin gets at least one behavioural test through the mock server, and pure helpers get unit tests.

### Recruiting and retention

1. **reserved-slot-reward** — `{ visits: 10, message: "…{name}…" }`. Counts visits per steamId in its own state on
   `player.join`. When the count reaches `visits` and the id is not already in `GET /v1/reserved-slots`, call
   `addReservedSlot`, DM the message, and log. Never grant twice (state `granted`).
2. **comeback** — `{ awayDays: 14, delayMs: 8000, message: "Welcome back, {name}! It's been {days} days. …" }`.
   Tracks `lastSeen` per steamId (update on leave and on every 10th tick). On join, if last seen ≥ `awayDays` ago →
   DM after the delay (skip if they left). `{days}` = whole days away.
3. **kill-streak** — `{ thresholds: [5, 10, 20], message: "{name} is on a {kills}-kill streak!" }`. On `tick`, for
   each player, kills gained since the match started (baseline = kills at first sight this match). Broadcast once
   per threshold per player per match; reset on `match.new`.
4. **first-timer** — `{ message: "First time on {server}: welcome {name}! Say hi." }`. On join, if the steamId is not
   in state `seen` → broadcast (not DM) and record.
5. **playtime-ranks** — `{ ranks: [{ hours: 1, title: "Regular" }, { hours: 10, title: "Veteran" }, { hours: 50, title: "Legend" }], announce: "{name} just reached {title} ({hours} h on {server})!" }`.
   Accumulate minutes per steamId from `player.leave` `sessionSeconds` (ignore null). On join and on leave, if a
   new rank threshold was crossed since the last announced rank → broadcast once per rank.
6. **discord-announce-bridge** — `{ channelId: "", botToken: "", intervalSeconds: 60, prefix: "[Discord] ", ignoreBots: true, maxLength: 200 }`.
   `botToken` falls back to `host.discordBotToken`; both `channelId` and a token required. `every(interval)`:
   `GET https://discord.com/api/v10/channels/{channelId}/messages?limit=20` (+`&after=<lastId>` once known) with
   `Authorization: Bot <token>`. First fetch only seeds `lastId` (newest message id). Then broadcast each new
   message's `content` (oldest first, skip empty, skip `author.bot` if `ignoreBots`, truncate to `maxLength`) as
   `prefix + author.username + ": " + content`. Persist `lastId`. Allow a `baseUrl` option (default the Discord
   API) so tests can point it at the mock.
7. **prime-time** — `{ atPlayers: 20, message: "{server} is popping: {players}/{max} online on {map}!", oncePerHours: 12, webhookUrl: "" }`.
   On tick, when `players.current` crosses from below to ≥ `atPlayers`, post to Discord (webhook or
   `host.discordWebhookUrl`) unless posted within `oncePerHours`. Persist last post time.

### Moderation

8. **name-filter** — `{ patterns: ["(?i)\\bslur1\\b"], kickReason: "Name violates server rules", dmBeforeKick: "Your name breaks our rules; change it and rejoin." }`.
   Patterns are JS regex sources (support a leading `(?i)` by stripping it and adding the `i` flag). Check every
   player on every tick (so baseline players are covered); kick once (track kicked ids for the session).
9. **afk-kick** — `{ afterMinutes: 10, onlyWhenAbove: 0.8, warnMinutesBefore: 2, kickReason: "AFK for {minutes} min", exemptReserved: true }`.
   A player is idle when `kills`, `deaths`, and `cash` are all unchanged since their last change timestamp. Only
   act when `players.current / players.max >= onlyWhenAbove`. DM a warning at `afterMinutes - warnMinutesBefore`,
   kick at `afterMinutes`. Reserved slots exempt (refresh every 5 min).
10. **temp-bans** — `{ checkSeconds: 60 }`. Reads `${dataDir}/temp-bans.json` (`[{ steamId, reason, expiresAt: ISO }]`,
    written by the CLI). Every `checkSeconds` and at setup: for entries past `expiresAt`, call `unban`, remove the
    entry, log. Add CLI command `wd tempban <steamId> <duration> [reason…]` where duration is `30m|12h|3d|2w`: it
    bans immediately via the API and appends to that file (create if missing; DATA_DIR from `loadHostConfig`).
    Add `wd tempbans` to list them. Export `parseDuration(s): number` and unit-test it.
11. **vac-check** — `{ action: "flag" | "kick", kickReason: "VAC/game-banned accounts are not allowed here", minGameBans: 1, webhookUrl: "" }`.
    Needs `host.steamApiKey`. On join (and once for baseline players), `SteamClient.bans`; if `vacBanned` or
    `gameBans >= minGameBans`: `flag` → log + Discord post if a webhook is set; `kick` → kick with reason. Cache
    checked ids for 6 h.
12. **new-account-gate** — `{ minAccountDays: 30, action: "flag" | "kick", kickUnknown: false, kickReason: "Steam account too new for this server" }`.
    Needs `host.steamApiKey`. Uses `SteamClient.summaries().createdAt`; `null` (private profile) → only kick when
    `kickUnknown`. Same flag/kick semantics as vac-check.
13. **admin-alerts** — `{ events: ["kick", "ban", "unban", "config", "map"], ignorePeers: [], webhookUrl: "" }`.
    On `audit.entry`, if `entry.event` (lower-cased) contains any listed word and `entry.peer` is not in
    `ignorePeers` → Discord post `**{event}** by {peer}: {detail}`. Needs a webhook.

### Match and map

14. **rotation-scheduler** — `{ schedules: [{ days: ["fri","sat"], from: "19:00", to: "23:59", entries: [{ map, experiences?, lighting?, zoneAlternator? }] }], checkSeconds: 60 }`.
    Every check: find the active schedule for local now (days may be `["*"]`). When the active schedule changes
    (including → none, which does nothing), replace the rotation: `GET /v1/rotation`, delete entries from the last
    index down to 0, add each schedule entry, `saveRotation`. Persist the last applied schedule key.
    Export `activeSchedule(schedules, now): index | -1` and unit-test day/time matching (including a `to` past midnight).
15. **population-maps** — `{ tiers: [{ maxPlayers: 20, maps: ["Kavkazi"] }, { maxPlayers: 999, maps: ["Europe"] }], graceSeconds: 20 }`.
    On `match.new`, wait `graceSeconds`, re-read snapshot; pick the first tier with `players.current <= maxPlayers`;
    if the current map is not in that tier's list → `changeMap({ map: random })`. Never twice per match.
16. **stale-match** — `{ maxMinutes: 90 }`. On tick, if `matchSeconds > maxMinutes*60` and not already done for
    this match → `endMatch()`, log, mark done; reset on `match.new`.
17. **weather-randomizer** — `{ lightings: ["DayClear", "DayLateGray"], weights: [], excludeCurrent: true }`. On
    `match.new`, pick a lighting (weighted if `weights` has the same length, else uniform; avoid the current one when
    `excludeCurrent`) → `setLighting`. Export `pickWeighted(items, weights, rng)` and unit-test with a fixed rng.
18. **score-tick-tuner** — `{ table: [{ upToPlayers: 20, scoreTick: 30 }, { upToPlayers: 50, scoreTick: 24 }, { upToPlayers: 999, scoreTick: 18 }], cooldownSeconds: 120 }`.
    On tick, find the row for `players.current`; clamp to `status.scoreTick.min..max`; if it differs from
    `status.scoreTick.current` and cooldown elapsed → `patchSettings({ scoreTick })`.
19. **sponsor-rotator** — `{ imageUrls: [], everyHours: 6 }`. `every(everyHours h)` (immediate): advance a persisted
    index and `setSponsor(url)`; skip if the URL already equals `GET /v1/sponsor`.
20. **config-backup** — `{ checkMinutes: 10, keep: 50 }`. `every` (immediate): `GET /v1/config`; if `revision`
    differs from the persisted one → write `${dataDir}/config/<ISO-ts>-<revision>.ini`, log
    `+n −m lines` versus the previous backup (simple line-set diff), delete oldest beyond `keep`. Also emit at info
    which keys changed (lines that differ, first 5).

### Stats and reporting

21. **weekly-recap** — `{ day: "sun", time: "18:00", webhookUrl: "", top: 5 }`. Uses `event-announcer`'s
    `dueReminders` idea (import `nextOccurrence`): every 60 s, if `now` is within the minute of the scheduled slot
    and not yet sent for this occurrence → `readStats(dataDir, now - 7d)`; post an embed to Discord: top `top`
    players by kills (from sessions), top by playtime, busiest three hours (from `hourlyPlayerCounts`), number of
    distinct players, total sessions. Persist sent keys.
22. **leaderboard** — `{ everyMinutes: 30, top: 20, postEveryHours: 0, webhookUrl: "" }`. `every` (immediate):
    `readStats(dataDir, 0)` → `playtimeBySteamId` → write `${dataDir}/leaderboard.json` (sorted by kills desc, then
    minutes desc, top `top` plus `updatedAt`). If `postEveryHours > 0`, post the top 10 to Discord on that cadence.
23. **steam-profiles** — `{ refreshHours: 24 }`. Needs `host.steamApiKey`. On join (and baseline), fetch
    summaries; write `${dataDir}/profiles.json` (`{ [steamId]: { name, avatar, country, updatedAt } }`), refresh
    entries older than `refreshHours`. Other plugins may read that file; keep it simple.
24. **prometheus-metrics** — `{ path: "/metrics" }`. Needs `host.httpPort`. Registers the route on the shared web
    server. Output (text/plain; version=0.0.4): `wardogs_up 0|1`, `wardogs_players`, `wardogs_players_max`,
    `wardogs_match_seconds`, `wardogs_score_tick`, `wardogs_ping_ms_avg`, `wardogs_ping_ms_max`,
    `wardogs_faction_score{faction="…"}` (using the discord-relay `scoreOf` helper — import it),
    `wardogs_faction_players{faction="…"}`, `wardogs_last_poll_age_seconds`. Labels escaped.
25. **web-dashboard** — `{ path: "/" }`. Needs `host.httpPort`. One HTML page, inline CSS, no JS libraries: server
    name + status line, current players table (name, faction, K/D, ping), top 20 from `leaderboard.json` and
    `regulars.json` if present, and a 24-row table of average players per hour from the last 24 h of snapshots.
    Escape all text. Refresh meta tag every 30 s.

### Ops

26. **health-endpoint** — `{ path: "/healthz", staleAfterPolls: 3 }`. Needs `host.httpPort`. 200 `ok` when the last
    successful poll is younger than `staleAfterPolls * pollMs`, else 503 `stale` (or `down` when the host reports
    the server down). Body is JSON `{ ok, lastPollAgeMs, serverUp }`.
27. **downtime-alert** — `{ afterMinutes: 5, webhookUrl: "", recoveredMessage: true }`. On `server.down` start a
    timer; if still down after `afterMinutes` → Discord post once. On `server.up` → cancel, and if an alert was
    posted, post a recovery message with the outage length.

## Host tweaks needed

- Expose whether the server is currently up on the context: add `ctx.serverUp(): boolean` (true until the first
  failed poll after a success; false while down) and `ctx.lastPollAt(): number | null`. Implement in `host.ts`.
- `ctx.every` already exists; `ctx.state` for persistence. Nothing else should need host changes — if something
  does, keep it minimal and explain it in the final summary.

## Finish line

`npm run check` green, `npx prettier --check "src/**/*.ts"` clean, README table and `plugins.example.json`
updated for all 27, `.env.example` updated (`DISCORD_BOT_TOKEN`, `HTTP_PORT`). Do not commit. End with a summary
listing any spec deviations.
