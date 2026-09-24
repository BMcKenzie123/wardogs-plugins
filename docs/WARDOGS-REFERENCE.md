# wardogs.tech — exhaustive reference

Everything documented on <https://wardogs.tech> as of 2026-09-12 (API reference v0.27, last updated 2026-09-10),
collected into one place for plugin authors. The site is unofficial and community-maintained; so is this file.
Verify anything that matters against your own server.

Sources: `/rcon-reference` (all ten sections), `/openapi.json`, `/ServerSettings.ini`, `/rcon-api`, `/dev`,
`/discord-help`, `/map-guide`, `/demo`, `/demo/admin`, `/`, `/terms`, `/privacy`.

---

## 1. Site map

| URL                             | What it is                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                             | Landing page for the Discord tactical-map app (war rooms). Links: add, create, join, demo, dev                                               |
| `/#how`                         | Three-step install: add to server → Start an Activity → pick wardogs.tech                                                                    |
| `/add`                          | Install the Discord app to a server (everyone gets it; no bot joins; no permissions)                                                         |
| `/add?to=account`               | Install to your own Discord account only (works in every server you are in)                                                                  |
| `/create`, `/join`              | Open / join a war room (shared map, no sign-in)                                                                                              |
| `/demo`                         | Live shared map demo; resets every 5 minutes                                                                                                 |
| `/demo/admin`                   | Proof-of-concept **server admin dashboard** against a real test RCON server (see §10)                                                        |
| `/dev`                          | Dev hub index linking everything below                                                                                                       |
| `/rcon-reference`               | The RCON HTTP API + ServerSettings.ini reference. Anchors: `#overview #base #auth #conventions #endpoints #shapes #steam #config #ai #notes` |
| `/rcon-reference#ai`            | Plain-text "paste into Claude/ChatGPT" version of the API (reproduced verbatim in Appendix A)                                                |
| `/rcon-api`                     | Scalar interactive console driven by the OpenAPI spec; generates clients (Shell, Ruby, Node, …)                                              |
| `/openapi.json`                 | OpenAPI 3.0.3 document, `info.version` 0.27, `x-lastUpdated` 2026-09-10, `x-apiVersion` v1                                                   |
| `/ServerSettings.ini`           | Commented starter config with every honored key (reproduced in §6)                                                                           |
| `/discord-help`                 | Why the map won't launch in a voice channel (see §11)                                                                                        |
| `/map-guide`                    | Internal: how the HD tactical map tiles are produced (see §12)                                                                               |
| `/terms`, `/privacy`            | Updated 9 September 2026 (see §13)                                                                                                           |
| `https://discord.gg/FhWDZQn9Gy` | wardogs.tech community Discord                                                                                                               |

---

## 2. RCON HTTP API — transport, auth, conventions

- **Base URL:** `<scheme>://<host>:<port>` — everything lives under `/v1`.
- **Port:** default **7776**; settable via config `Port=` or launch argument `-RCONPort=`.
- **Scheme is decided by the listener bind:**
  - `BindAddress=127.0.0.1` (loopback) → plaintext `http://` allowed, plaintext `Password` allowed.
  - `BindAddress=0.0.0.0` (network) → **TLS required** (cert + key) **and** `PasswordHash` required, or the listener will not start. Any server you reach remotely is `https://`.
- **Auth:** `Authorization: Bearer <rcon-password>` on every request. No login step. **One token, full access** (read and write, including kick, ban, config replacement, ending a match). Keep it server-side; never in a browser.
- **Connection check:** `GET /v1/status` succeeding means the token is good.
- **Content types:** JSON in and out (`application/json`) **except** `PUT /v1/config` and `POST /v1/config/validate`, which send and receive `text/plain`.
- **Errors:** non-2xx with body `{ "error": { "code": string, "message": string } }`. `PUT /v1/config` returns **412** with a `ConfigResult` body when the `If-Match` revision is stale.
- **Feature detection:** `GET /v1/capabilities` → `{ routes: string[], config: { writable: boolean } }`. Route strings look like `"PATCH /v1/players/{id}"`. The official panel shows "change team" only when that route is present, and the config editor only when `config.writable` is true. **Not every server enables every route.**
- **Browser callers:** an HTTPS page can call a TLS server directly; it cannot call a plaintext loopback listener (mixed content).
- **Hosted reality check (xREALM, 2026-09-20):** the RCON endpoint the panel hands out (`<ip>:<mapped port>`) is **plain HTTP**, not TLS, despite the note above; the host maps the game's loopback listener out through its own port. So `RCON_SCHEME=http` there, and the bearer token crosses the internet unencrypted. Unauthenticated calls return `401 {"error":{"code":"credential_missing",…}}`. A live server reported 29 routes; `capabilities.build` read `++Wardogs+Live-CL-501228` on 2026-09-24, and its `/v1/status` omits `matchSeconds` and `scoreCap` (treat both as optional). Rate limit per `capabilities.limits`: 600 requests/min per IP. On that build a map rotation at 100 players kicked every client to the menu (manual rejoin from the browser); the host now logs each reconnect window per poll for reporting to the host.
- **Rate limits:** none published. The panel refreshes every 3–5 s; the wardogs.tech dashboard polls once a minute. Poll gently.
- **Path params:** `{steamId}` is a SteamID64 string; `{id}` a map id; `{i}` a rotation entry index (integer).

---

## 3. Endpoints (35 = 14 read + 21 write)

Tags in the OpenAPI spec: Match state, Players, Moderation, Match control, Rotation, Catalog, Config, Meta, Sponsor.

### Read (14)

| #   | Method | Path                                | Query / params                | Response schema   | Notes                                         |
| --- | ------ | ----------------------------------- | ----------------------------- | ----------------- | --------------------------------------------- |
| 1   | GET    | `/v1/status`                        | —                             | `Status`          | Live match state                              |
| 2   | GET    | `/v1/players`                       | —                             | `Players`         | Connected players with kills/deaths/cash/ping |
| 3   | GET    | `/v1/capabilities`                  | —                             | `Capabilities`    | Supported routes + config flags               |
| 4   | GET    | `/v1/bans`                          | —                             | `Bans`            | Ban list                                      |
| 5   | GET    | `/v1/reserved-slots`                | —                             | `ReservedSlots`   | Reserved-slot steamIds                        |
| 6   | GET    | `/v1/audit`                         | `limit` int 1–500, default 50 | `Audit`           | Admin action log                              |
| 7   | GET    | `/v1/config`                        | —                             | `Config`          | Config document, revision, warnings           |
| 8   | GET    | `/v1/rotation`                      | —                             | `Rotation`        | Rotation entries with now/next markers        |
| 9   | GET    | `/v1/catalog/maps`                  | —                             | `Catalog` (loose) | Available maps                                |
| 10  | GET    | `/v1/catalog/lightings`             | —                             | `Catalog` (loose) | Lighting presets                              |
| 11  | GET    | `/v1/catalog/experiences`           | —                             | `Catalog` (loose) | All experiences (modes)                       |
| 12  | GET    | `/v1/catalog/maps/{id}/experiences` | path `id` = map id            | `Ok` (loose)      | Experiences valid for one map                 |
| 13  | GET    | `/v1/catalog/maps/{id}/alternators` | path `id` = map id            | `Ok` (loose)      | Zone alternators for one map                  |
| 14  | GET    | `/v1/sponsor`                       | —                             | `Sponsor`         | Sponsor banner image URL                      |

### Write (21)

| #   | Method | Path                            | Body                                                                                             | Response                    | Notes                                                       |
| --- | ------ | ------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------- |
| 15  | POST   | `/v1/players/{steamId}/kick`    | `{ reason }` (JSON, `reason` optional)                                                           | `Ok`                        | Kick                                                        |
| 16  | POST   | `/v1/players/{steamId}/kill`    | none                                                                                             | `Ok`                        | Kill in-match                                               |
| 17  | POST   | `/v1/players/{steamId}/message` | `{ message }` (required)                                                                         | `Ok`                        | Direct message                                              |
| 18  | PATCH  | `/v1/players/{steamId}`         | `{ faction }` (required)                                                                         | `Ok`                        | Change faction. **Capability-gated**                        |
| 19  | POST   | `/v1/broadcast`                 | `{ message }` (required)                                                                         | `Ok`                        | Message everyone                                            |
| 20  | POST   | `/v1/bans`                      | `{ steamId (required), reason? }`                                                                | `Ok`                        | Ban; persisted to `+DefaultBannedPlayerIds`                 |
| 21  | DELETE | `/v1/bans/{steamId}`            | none                                                                                             | `Ok`                        | Unban                                                       |
| 22  | POST   | `/v1/reserved-slots`            | `{ steamId }` (required)                                                                         | `Ok`                        | Add reserved slot; persisted to `+DefaultReservedPlayerIds` |
| 23  | DELETE | `/v1/reserved-slots/{steamId}`  | none                                                                                             | `Ok`                        | Remove reserved slot                                        |
| 24  | POST   | `/v1/match/map`                 | `MapSelection` = `{ map (required), experiences?, lighting?, zoneAlternator? }`                  | `Ok`                        | Change map now                                              |
| 25  | POST   | `/v1/match/end`                 | none                                                                                             | `Ok`                        | End current match                                           |
| 26  | POST   | `/v1/match/restart`             | none                                                                                             | `Ok`                        | Restart current match                                       |
| 27  | PUT    | `/v1/world/lighting`            | `{ lighting }` (required)                                                                        | `Ok`                        | Set lighting/weather live                                   |
| 28  | POST   | `/v1/rotation/entries`          | `MapSelection`                                                                                   | `Ok`                        | Add rotation entry                                          |
| 29  | DELETE | `/v1/rotation/entries/{i}`      | none                                                                                             | `Ok`                        | Remove entry at index                                       |
| 30  | POST   | `/v1/rotation/entries/{i}/move` | `{ direction: "up" \| "down" }` (required, enum)                                                 | `Ok`                        | Move entry                                                  |
| 31  | POST   | `/v1/rotation/save`             | none                                                                                             | `Ok`                        | Persist rotation to the ini                                 |
| 32  | PATCH  | `/v1/settings`                  | `{ scoreTick?: int, rotationEnabled?: bool, rotationMode?: string }`                             | `Ok`                        | Live settings patch                                         |
| 33  | POST   | `/v1/config/validate`           | config text, `text/plain`                                                                        | `ConfigResult`              | Validate without applying                                   |
| 34  | PUT    | `/v1/config`                    | config text, `text/plain`; header `If-Match: "<revision>"`; query `force=true`, `fullApply=true` | `ConfigResult` (200) or 412 | Apply config                                                |
| 35  | PUT    | `/v1/sponsor`                   | `{ imageUrl }` (required)                                                                        | `Ok`                        | Set sponsor banner                                          |

---

## 4. Response shapes (every documented field)

```
Ok            { ok?: boolean, message?: string }
Error         { error: { code: string, message: string } }

Status        { serverName: string,
                map: string,                       // map id, e.g. "Kavkazi"
                experiences: string[],
                lighting: string,
                alternator: string,
                scoreTick: { current, min, max },  // integers
                scoreCap: integer,
                matchSeconds: integer,
                players: { current, max },
                factionScores: [ { name, colorHex, … } ],   // one row per faction; servers add more fields (score)
                rotation: { nowIndex: int|null, nextIndex: int|null } | null }

Player        { name, steamId, faction, kills, deaths, cash, pingMs }
Players       { players: Player[] }
                // faction is a server-defined name; the stable key across a server is factionScores[].colorHex

Capabilities  { routes: string[], config: { writable: boolean } }

Ban           { steamId, bannedAtUtc, bannedBy, reason }
Bans          { bans: Ban[] }
ReservedSlots { reservedSlots: string[] }          // steamIds

AuditEntry    { timestampUtc, peer, sessionId, event, detail }
Audit         { entries: AuditEntry[] }

RotationEntry { map, experiences: string[], lighting, zoneAlternator, status, denied: boolean }
                // status: "now" | "next" | other server-defined markers
Rotation      { enabled: boolean, mode: "ordered" | "random", entries: RotationEntry[] }

Config        { revision: string, writable: boolean, text: string, sections: object[], warnings: string[] }

ConfigResult  { ok: boolean, revision: string,
                error: { code, message },
                outcomes: [], shadowed: [], stripped: [], errors: [], changed: [],
                conflict: [],                      // present on HTTP 412 (revision mismatch)
                warnings: [], timingsMs: object|null }

MapSelection  { map: string (required), experiences?: string[], lighting?: string, zoneAlternator?: string }
SettingsPatch { scoreTick?: integer, rotationEnabled?: boolean, rotationMode?: string }
Sponsor       { imageUrl: string }
Catalog       shape varies by endpoint (maps / lightings / experiences) — treat as opaque JSON
```

Things the API **does not** return: Steam display names, avatars, player positions, health, kill events, chat,
team-kill events, explicit match-start/end events, join/leave events. All of those are absent or must be inferred
by polling (see §9).

---

## 5. Identifiers seen anywhere on the site

Server-defined; the catalog endpoints are the real list for your build. These are the ones that appear in examples.

| Kind                       | Values                                                                                           | Where           |
| -------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| Map ids (RCON)             | `Kavkazi`, `Europe`, `Ozeti` (demo shows "OZETI")                                                | reference, demo |
| Map ids (tactical map app) | `zesty`, `bakurani`, `ozeti` — the three current maps as overhead PNGs                           | map-guide       |
| Experiences (modes)        | `Bakurani_KOTH_01`, `Madrid_KOTH_01`, `KOTH_InfantryOnly` (joined with `+`)                      | reference, ini  |
| Mode names (display)       | "King of the Hill · Infantry"                                                                    | demo            |
| Lighting                   | `DayClear`, `DayLateGray`, "Day Early Fog" (display name in demo)                                | reference, demo |
| Zone alternator            | `ZoneAlternator.Factory.Circle`                                                                  | reference       |
| Factions                   | **three** in the demo: `VALKYRA`, `LONESTAR`, `MANTICORE` (scores 97 / 62 / 77 in the snapshot)  | demo            |
| Rotation modes             | `Ordered`, `Random` (ini) / `"ordered"`, `"random"` (API)                                        | reference       |
| Score tick                 | `ScorePeriod` 18–30 s, default 24                                                                | reference       |
| Player slots               | `MaxPlayers` default 128 in the reference table, **32 in the starter template**; demo server 100 | reference, ini  |

---

## 5b. What a live server reported (xREALM-hosted, build 5.7.4, 2026-09-20)

Fetched over RCON from a real community server; this is the ground truth the examples in this repo use.

**Routes (29).** Everything in §3 **except**: `POST /v1/reserved-slots`, `DELETE /v1/reserved-slots/{steamId}`,
`POST /v1/rotation/entries`, `DELETE /v1/rotation/entries/{i}`, `POST /v1/rotation/entries/{i}/move`,
`POST /v1/rotation/save`, `PATCH /v1/settings`, `PUT /v1/sponsor`. Reserved slots, the rotation and the sponsor
banner are therefore config-file-only on this build (`PUT /v1/config`). Two routes are present but undocumented:

| Route               | Returns                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/server-id` | `{ "serverId": "<uuid>" }`                                                                                                      |
| `GET /v1/health`    | `{ "status": "ok", "uptimeSeconds", "connections": { "active" }, "gameThreadQueue": { "inFlight", "depth", "rejectedTotal" } }` |

`config.writable` was `true`. Route parameter names differ from the docs (`{map}` and `{id}` instead of `{id}`/`{steamId}`); match on shape, not text.

**Map ids vs. level names.** `GET /v1/status` `map` reports the _level_ (e.g. `Bakurani`), while the catalog, the
rotation and `POST /v1/match/map` use the _map id_. Compare against the rotation's `now` entry when you need the id.

| Map id         | Level name in status | Experiences                                              | Zone alternators                                                          |
| -------------- | -------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Kavkazi`      | `Bakurani`           | `Bakurani_KOTH_01`, `KOTH_InfantryOnly`, `KOTH_Hardcore` | `ZoneAlternator.Bakurani.{Default,Farmland,Lumberyard}.Circle`            |
| `Europe`       | `Ozeti`              | `Madrid_KOTH_01`, `KOTH_InfantryOnly`, `KOTH_Hardcore`   | `ZoneAlternator.Ozeti.{Default,Farmland,Church,River}.Circle`             |
| `NorthAmerica` | `Zestafona`          | `Detroit_KOTH_01`, `KOTH_InfantryOnly`, `KOTH_Hardcore`  | `ZoneAlternator.Zestafona.{Default,SmallFactory,WaterTreatment,…}.Circle` |

**Lighting ids (8):** `DayStartClear`, `DayEarlyClear`, `DayEarlyFog`, `DayClear`, `DayLateClear`, `DayLateGray`,
`DayLateGrayFog`, `DayEndClear`. There is no night preset on this build.

**Catalog shapes:** `GET /v1/catalog/maps` → `{ maps: [{ id, displayName }], count }`; lightings and experiences the
same with `lightings` / `experiences`; `/v1/catalog/maps/{id}/experiences` → `{ map, experiences: string[], count }`;
`/v1/catalog/maps/{id}/alternators` → `{ map, alternators: [{ index, tag, displayName }], count }`.

**Factions and colours:** Lonestar `#4CB1EF`, Valkyra `#FA503E`, Manticore `#1DD65C`. **Slots:** 100.
**Transport:** the host maps the game's RCON out on `<ip>:<port>` as **plain HTTP** (see §2).

---

## 6. ServerSettings.ini — every honored section and key

Read once at server startup. Only whitelisted sections/keys are honored; everything else is stripped. Omitted or
`;`-commented keys keep their default. The RCON ban / reserve / rotation commands edit this file and persist back to
it. `GET /v1/config` returns the document with a `revision`; `PUT /v1/config` replaces it (send `If-Match`).

### `[/Script/WDRCON.WDRCONSettings]` — the RCON listener

| Key            | Default (template) | Meaning                                                                                           |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `bEnabled`     | `false`            | Listener is **off** by default                                                                    |
| `BindAddress`  | `127.0.0.1`        | Loopback = plaintext ok. `0.0.0.0` = all interfaces, **requires TLS cert + key and PasswordHash** |
| `Port`         | `7776`             | Or launch with `-RCONPort=`                                                                       |
| `Password`     | (empty)            | Plaintext. If empty, auto-generated each boot and written to `Saved/RCON/ADMIN-PASSWORD.txt`      |
| `PasswordHash` | `""`               | From `WardogsServer -GenerateRCONHash=<password>`; **wins over** `Password` when both are set     |

### `[/Script/WDGame.WDGameSession]` — session

| Key                         | Default | Applies      | Meaning                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ServerName`                | —       | immediately  | Name in the server browser                                                                                                                                                                                                                                                                                                   |
| `ServerPassword`            | (empty) | next restart | Join password; empty = open                                                                                                                                                                                                                                                                                                  |
| `ServerMinPlayerCash`       | `0`     | next restart | Minimum cash to join; 0 = none                                                                                                                                                                                                                                                                                               |
| `ServerMaxPlayerCash`       | `0`     | next restart | Maximum cash to join; 0 = none                                                                                                                                                                                                                                                                                               |
| `ServerMinPlayerLevel`      | `0`     | next restart | Minimum level to join; 0 = none                                                                                                                                                                                                                                                                                              |
| `ServerMaxPlayerLevel`      | `0`     | next restart | Maximum level to join; 0 = none                                                                                                                                                                                                                                                                                              |
| `ServerImageURL`            | —       | pending      | Sponsor banner: 1024×256 PNG/JPEG. **Host must be on the ImageURLWhitelist** — approved: catbox.moe, imgbb.com, postimg.cc (links come from their CDNs, e.g. `i.ibb.co`, `i.postimg.cc`, `files.catbox.moe`). Any other host is refused outright and nothing is downloaded. Inappropriate images get the server blacklisted. |
| `MaxReservedSlots`          | `20`    | immediately  | How many reserved slots exist                                                                                                                                                                                                                                                                                                |
| `+DefaultReservedPlayerIds` | —       | —            | One line per SteamID64; edited by the RCON reserve add/remove commands                                                                                                                                                                                                                                                       |
| `+DefaultBannedPlayerIds`   | —       | —            | One line per SteamID64; edited by the RCON ban/unban commands                                                                                                                                                                                                                                                                |

### `[/Script/Engine.GameSession]` — player slots

| Key          | Default                         | Applies     | Meaning                                         |
| ------------ | ------------------------------- | ----------- | ----------------------------------------------- |
| `MaxPlayers` | `128` (table) / `32` (template) | immediately | Total slots; clamped by a developer-set min/max |

### `[MatchState.PreMatch.WaitingForPlayers.PlayerCount]` — pre-match

| Key                      | Default | Applies    | Meaning                                                |
| ------------------------ | ------- | ---------- | ------------------------------------------------------ |
| `MinimumRequiredPlayers` | `60`    | next match | Players required before pre-match becomes a live match |

### `[MatchState.Playing.KOTH]` — KOTH scoring

| Key           | Default | Applies    | Meaning                                                                |
| ------------- | ------- | ---------- | ---------------------------------------------------------------------- |
| `ScorePeriod` | `24`    | next match | Seconds between score ticks (18–30). A faster tick pays less each time |

### `[/Script/WDGame.WDGameStateSession]` — team balancing

| Key                                | Default | Applies    | Meaning                                                         |
| ---------------------------------- | ------- | ---------- | --------------------------------------------------------------- |
| `bLockOverpopulatedTeamsConfig`    | `true`  | next match | Stop players joining a team that already leads by the threshold |
| `OverpopulatedTeamThresholdConfig` | `2`     | next match | How many players ahead a team must be before it locks           |

### `[/Script/WDGame.WDServerMapRotationSettings]` — map rotation

| Key                | Default   | Applies     | Meaning                                                 |
| ------------------ | --------- | ----------- | ------------------------------------------------------- |
| `bEnabled`         | `true`    | immediately | Advance through the rotation after each match           |
| `RotationMode`     | `Ordered` | immediately | `Ordered` walks top to bottom; `Random` picks each next |
| `+RotationEntries` | —         | immediately | One map entry per line, format below                    |

Rotation entry format:

```ini
+RotationEntries=(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear",ZoneAlternator="ZoneAlternator.Factory.Circle")
+RotationEntries=(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")
```

`Experience` (singular) is one; `Experiences` (plural) joins several with `+`. `ZoneAlternator` is optional (omit for
the map's authored default). `Lighting` is a lighting scenario.

Live configs written by the panel pad the assignment (`ServerImageURL            = https://…`); the parser accepts spaces around `=`.

Launch arguments mentioned: `-RCONPort=<port>`, `-GenerateRCONHash=<password>` (run as `WardogsServer -GenerateRCONHash=…`).

---

## 7. Player names and avatars (Steam)

- `/v1/players` gives in-game `name` and `steamId` only. No Steam profile name, no avatar.
- Resolve yourself: Steam Web API `ISteamUser/GetPlayerSummaries` with your own key. Batch ids and cache; names change rarely.
- The official admin panel uses a small proxy on its own host: `GET /api/steam/profiles?ids=…`, key in an
  `X-Steam-Api-Key` header, up to **32 ids per call**, returns `{ "<steamId>": { name, avatar } }`. That proxy is
  **not** part of the game server API.
- wardogs.tech's own dashboard also stores the player's public Steam **country** when set.

---

## 8. Operational notes (the site's own)

1. Check `GET /v1/capabilities` per server; not every route is always enabled.
2. Poll gently: a few seconds between calls; the panel uses 3–5 s.
3. Match factions by colour: a player's `faction` is a name; `factionScores[].colorHex` is the stable key.
4. Keep the token off the client; requests belong on a server you control.
5. The reference is unofficial and may be incomplete or change; verify against your server.
6. "Wardogs itself changes; features that depend on the game's server API can stop working when it does." (terms)

---

## 9. What you can and cannot build on this API

**Observable by polling:** who is on (steamId, name, faction, kills, deaths, cash, ping), player count, map,
experiences, lighting, alternator, faction scores, match clock, score tick, rotation position, bans, reserved
slots, the admin audit log, the config document and its revision, catalogs, sponsor URL.

**Actions:** DM, broadcast, kick, kill, ban, unban, change faction (if enabled), reserve/unreserve, change map,
end/restart match, set lighting, edit and save rotation, patch score tick / rotation settings, replace the whole
config, set the sponsor banner.

**Not available (must be inferred or is impossible):**

| Want                                      | Reality                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Read chat / chat commands                 | No endpoint. Nothing can react to what players type.                               |
| Join / leave events                       | Diff `/v1/players` between polls.                                                  |
| Match start / end events                  | Watch `matchSeconds` go backwards, or `map` change.                                |
| Kill feed, team kills, K/D per life       | Only cumulative `kills` / `deaths` per poll.                                       |
| Positions, health, vehicles               | Not exposed.                                                                       |
| Ping history                              | Only the current `pingMs`.                                                         |
| Steam names / avatars                     | Steam Web API with your own key.                                                   |
| Start / stop / restart the server process | Not exposed; use the host's panel (xREALM, QONZER, BisectHosting).                 |
| File access, logs                         | Not exposed; host panel only.                                                      |
| Native MOTD                               | Not in the game yet (on Bulkhead's upcoming list); broadcast/DM is the substitute. |
| Per-admin credentials                     | One shared token. wardogs.tech's dashboard layers Discord-role ranks on top of it. |

---

## 10. What wardogs.tech's own dashboard does (for comparison)

From `/demo/admin`, `/terms`, `/privacy`. "Proof of concept, early build, open to anyone."

- Live: whisper (DM), kick, move to another faction, override the map. Scoreboard updates within seconds because
  the demo points at a real RCON endpoint.
- History: every match on record with its final board and score movement; every player's sessions and playtime;
  a leaderboard. ("The official console keeps none of this.") Demo shows 141 matches on record, roster 12.
- Accountability: every action lands in the community's audit trail under the acting person's name; ranks come
  from Discord roles instead of a shared password.
- Data retention: polls the registered server **once a minute**; keeps players, map, scores; derives sessions,
  matches, playtime. Raw per-minute readings thinned after a day, dropped after two weeks; match results and
  playtime totals kept. Staff can add notes, warnings, watchlist entries, bans with screenshots or clip links,
  visible to that community's moderators and admins only.
- Demo server: plays King of the Hill around the clock; kicked players come back; bans expire in an hour;
  rotation, config and visitor writes reset at 04:00Z. Snapshot seen: map Ozeti, "King of the Hill · Infantry",
  lighting "Day Early Fog", factions Valkyra 97 / Lonestar 62 / Manticore 77, players 8/100, match clock 1:10:15.
- Stack (privacy page): Vercel hosting, Neon database, Upstash cache, Cloudflare realtime, Vercel Blob images,
  Steam Web API, Discord sign-in and role lists. RCON credentials stored encrypted.
- "Coming soon" on the homepage: server admin in the same Discord, in closed testing.

---

## 11. Discord help page — every fact

Why the tactical-map Activity will not launch in a voice channel.

- **Nine times out of ten:** a channel-level **Use Activities** deny beats the role permission, and **admins bypass
  it**, so the admin never sees the failure. Check Edit Channel → Permissions on the voice channel **and its
  category**; set Use Activities to neutral or allow for @everyone / the role.
- **Temp voice channels** ("join to create" hubs, temp-channel bots) are clones of a hub/template channel and inherit
  its overwrites. Fixing a live temp channel does not hold; **fix the hub**, then delete a temp channel and let the
  bot make a fresh one. Some bots give the creator extra permissions: creator can launch, joiners cannot.
- **The one-minute test:** create a new permanent voice channel, drag it to the very top outside every category,
  touch no permissions, have a **non-admin** join and launch. Works there → channel/category permission on the
  failing channel. Fails there too → server-wide: Server Settings → Apps → Activities (a different page from
  Integrations) and Integrations → wardogs.tech → Manage.
- **Symptom table:** app card with logo/tags and no Launch button = not installed for that person (admin installs,
  or three dots → Add to my apps). "Failed to Launch Activity" / "Unable to launch activity" = available but
  refused = permissions. "You do not have permissions to use activities in this channel" = same, and fix the hub if
  temp. No rocket button = not in a voice channel or activities denied. Works for owner only = admin bypass; never
  test as an admin.
- **Two install doors:** _Add to your server_ (`wardogs.tech/add`) = everyone in the server, no bot joins, no
  permissions to approve. _Add to my apps_ (three dots on the app card) = only you, in every server. Server
  Settings → Integrations lists a server install with who added it and when; a personal install is listed for nobody.
- **Not the problem:** the app being down (hundreds of servers run it), phones (supported; same channel permission),
  role setup (a channel deny beats perfect roles), the app needing more permissions (it asks for none).
- **Still stuck:** bring the one-minute-test result, your server, whether the failing person is an admin, and
  whether the channel is permanent or auto-created, to the community Discord.

---

## 12. Map guide — every fact

Internal doc on how the tactical map's HD imagery is built (not the game server).

- Sources: the three current maps as hi-res overhead PNGs from the r/WarDogs post "Hi-res images of all 3 current
  maps" (Bulkhead's assets, community-shared; credited in `public/maps/SOURCE.md`). Flat overhead captures, **no
  elevation data**, no scale metadata.
- Per map outputs: `<id>.webp` 2048px WebP q80 (867 KB–1.3 MB, base layer and permanent fallback); `<id>-hd.webp`
  4096px WebP q80 (2.6–4.7 MB, only used for maps without a tile pyramid, so currently dead weight); `<id>-thumb.jpg`
  480px JPEG q70 (35–58 KB); tile pyramid `tiles/<id>/{z}/{x}/{y}.webp` 256px WebP q80, levels 0–6 (top level
  16384px), **5,461 tiles per map**, stored on Vercel Blob with `max-age=31536000`; source `<id>_map.png`
  16384–32768px square, never committed.
- Scripts (run by hand, not CI): `scripts/optimize-maps.mjs` (sharp resizes, `withoutEnlargement`),
  `scripts/tile-maps.mjs` (`--maps`, `--max-level=6`, `--src`, `--concurrency=16`, `--quality=80`, `--tmp`,
  `--keep-local`; needs `BLOB_READ_WRITE_TOKEN`; Google-layout tiles re-keyed from `z/y/x` to `z/x/y`; resumable
  by skipping existing Blob paths; 4 retries with backoff), `scripts/generate-map.mjs` (procedural `default.jpg`
  2200×2200 JPEG q82 placeholder).
- Client: coordinates are normalised `[0,1]` points; stroke width / marker radius are fractions of map width;
  `TILE_NATURAL_SIZE = 2048` map-space units; zoom level `clamp(round(log2(scale·mapWidth/tileSize)), 0, maxLevel)`;
  previous level stays mounted until the new one loads; grid overlay 8 cols × 5 rows (A–H / 1–5);
  `DEFAULT_STROKE_WIDTH` 0.003; `STROKE_TTL_MS` 10 min; `ROOM_TTL_S` 24 h refreshed on activity.
- Custom maps: any commander can upload (8 MB cap, checked client- and server-side; any `image/*` passes);
  stored at `maps/<roomId>-<timestamp>.<ext>` on Blob; never tiled; the image's natural pixel size becomes that
  room's coordinate space; revert by picking a built-in map.
- Gotchas: HD swap is dead code for all three built-in maps; on-disk tile layout is row-then-column; re-tiling does
  not overwrite cached tiles (delete the Blob prefix first); two hardcoded map lists to keep in sync; Blob cleanup
  for expired rooms unconfirmed.
- Adding a built-in map: source a ≥16384px square PNG named `<id>_map.png`; register in both scripts; run both;
  add a `MapInfo` to `packages/shared/src/index.ts`; commit the three repo files; picker and `POST /api/rooms` pick it up automatically.

---

## 13. Legal and provenance

- Fan-made. Not affiliated with Bulkhead or Team17. Map imagery and game names belong to their owners.
- Terms and Privacy updated **9 September 2026**. Sign-in is Discord only (id, display name, avatar; server and role
  lists where linked; no message reading). One sign-in cookie, one demo visitor cookie, one preview cookie; no ad or
  tracking cookies. Account deletion from the account page.
- Registering a game server means you run it or have the operator's permission; every dashboard action is logged
  with the actor's name; the community, not wardogs.tech, is responsible for moderation.
- Acceptable use forbids cheating, attacking or overloading the service or any game server, impersonation, and
  scraping or reselling data.

---

## 14. Bulkhead's stated upcoming features (not from wardogs.tech)

From a developer post the repo owner supplied. Short-term "reactive quality of life" items, not yet released:

1. Community server favouriting
2. Tiered priority queues for community servers
3. Message of the Day prompt
4. Improved warmup activities
5. Disabling AFK kicking during seeding (implies a native AFK kick already exists)
6. Team switching controls

Plugin implications: a native MOTD will likely arrive as a config key (manageable via `PUT /v1/config`); team-switch
controls may change how `PATCH /v1/players/{id}` behaves; priority queues overlap with reserved slots.

---

## Appendix A — the `#ai` block, verbatim

The plain-text API summary the site offers for pasting into an AI assistant (from the `kb-text` textarea).

```text
# Wardogs server RCON API — UNOFFICIAL community reference (v1)
Use this as context when helping me build tools (status bots, dashboards, moderation helpers) against it.
Note: unofficial and may be incomplete or change. Confirm what a server supports via GET /v1/capabilities.

## Connection
Base URL: <scheme>://<host>:<port>/v1/...
Default RCON port is 7776 (settable in config or with -RCONPort=).
Transport depends on the listener bind: a loopback listener (127.0.0.1) allows
plaintext over http://; a network listener (0.0.0.0) REQUIRES TLS, so any server
you reach remotely is https://. Bodies/responses are JSON, except the two
config-document endpoints which use text/plain.
Auth: every request sends the header
  Authorization: Bearer <rcon-password>
There is no separate login. The one token authorizes every endpoint (read AND
write) — it is the full-access RCON password, so keep it server-side, never in a
browser. A browser page can call a TLS (https) server; it cannot call a
plaintext loopback listener from an https page (mixed content).
Connection check: GET /v1/status — a success means the token is valid.
Errors: non-2xx status with body { "error": { "code": string, "message": string } }.
Feature detection: GET /v1/capabilities -> { routes: string[], config: { writable: boolean } }.
Not every server enables every route; check here before assuming one exists.

## Read endpoints
GET /v1/status                              live match state (shape below)
GET /v1/players                             connected players (shape below)
GET /v1/capabilities                        supported routes + config flags
GET /v1/bans                                ban list
GET /v1/reserved-slots                      reserved steamIds
GET /v1/audit?limit=N                       admin action log (N 1-500, default 50)
GET /v1/config                              config document + revision
GET /v1/rotation                            map rotation
GET /v1/catalog/maps
GET /v1/catalog/lightings
GET /v1/catalog/experiences
GET /v1/catalog/maps/{id}/experiences
GET /v1/catalog/maps/{id}/alternators
GET /v1/sponsor

## Write endpoints (request body shown)
POST   /v1/players/{steamId}/kick           { reason }
POST   /v1/players/{steamId}/kill           (no body)
POST   /v1/players/{steamId}/message        { message }
PATCH  /v1/players/{steamId}                 { faction }           (capability-gated)
POST   /v1/broadcast                        { message }
POST   /v1/bans                             { steamId, reason? }
DELETE /v1/bans/{steamId}                    (no body)
POST   /v1/reserved-slots                   { steamId }
DELETE /v1/reserved-slots/{steamId}          (no body)
POST   /v1/match/map                        { map, experiences?, lighting?, zoneAlternator? }
POST   /v1/match/end                        (no body)
POST   /v1/match/restart                    (no body)
PUT    /v1/world/lighting                   { lighting }
POST   /v1/rotation/entries                 { map, experiences?, lighting?, zoneAlternator? }
DELETE /v1/rotation/entries/{i}              (no body)
POST   /v1/rotation/entries/{i}/move        { direction: "up" | "down" }
POST   /v1/rotation/save                     (no body)
PATCH  /v1/settings                          { scoreTick?, rotationEnabled?, rotationMode? }
POST   /v1/config/validate                   config text (text/plain)
PUT    /v1/config                            config text (text/plain); header If-Match: "<revision>"; query force=true, fullApply=true
PUT    /v1/sponsor                           { imageUrl }

## Response shapes
GET /v1/status:
{ serverName, map, experiences: string[], lighting, alternator,
  scoreTick: { current, min, max }, scoreCap, matchSeconds,
  players: { current, max },
  factionScores: [ { name, colorHex, ... } ],   // one row per faction
  rotation: { nowIndex, nextIndex } }           // integers, or null

GET /v1/players:
{ players: [ { name, steamId, faction, kills, deaths, cash, pingMs } ] }
  faction is a server-defined name; match it to a factionScores row by colorHex.

GET /v1/rotation:
{ enabled, mode: "ordered" | "random",
  entries: [ { map, experiences: string[], lighting, zoneAlternator,
               status: "now" | "next" | ..., denied: boolean } ] }

GET /v1/bans:            { bans: [ { steamId, bannedAtUtc, bannedBy, reason } ] }
GET /v1/reserved-slots:  { reservedSlots: string[] }
GET /v1/audit:           { entries: [ { timestampUtc, peer, sessionId, event, detail } ] }
GET /v1/config:          { revision, writable, text, sections: [], warnings: [] }

PUT /v1/config & POST /v1/config/validate result:
{ ok, revision, error: { code, message },
  outcomes: [], shadowed: [], stripped: [], errors: [], changed: [],
  conflict: [],        // present on HTTP 412 (stale revision)
  warnings: [], timingsMs }

## Player names
The API returns steamId only, not display names or avatars. Resolve them with the
Steam Web API (ISteamUser/GetPlayerSummaries) using your own key; batch and cache.

## ServerSettings.ini (server config, read at startup)
Only whitelisted sections/keys are honored; omitted keys keep defaults. RCON
ban/reserve/rotation commands edit this file and persist back to it.

[/Script/WDRCON.WDRCONSettings]   ; the RCON listener
bEnabled=true            ; OFF by default
BindAddress=127.0.0.1    ; loopback = plaintext ok; 0.0.0.0 = needs TLS
Port=7776                ; default
Password=                ; plaintext; if empty, auto-written to Saved/RCON/ADMIN-PASSWORD.txt
PasswordHash=""          ; from `WardogsServer -GenerateRCONHash=<pw>`; wins over Password

[/Script/WDGame.WDGameSession]
ServerName= ; ServerPassword= (empty=open) ; ServerImageURL= (1024x256)
ServerMinPlayerCash=0 ; ServerMaxPlayerCash=0 ; ServerMinPlayerLevel=0 ; ServerMaxPlayerLevel=0
MaxReservedSlots=20
+DefaultReservedPlayerIds="<steamId64>"   ; one per line
+DefaultBannedPlayerIds="<steamId64>"     ; one per line

[/Script/Engine.GameSession]
MaxPlayers=128           ; clamped by a dev-set min/max

[MatchState.PreMatch.WaitingForPlayers.PlayerCount]
MinimumRequiredPlayers=60

[MatchState.Playing.KOTH]
ScorePeriod=24           ; score tick seconds, 18-30

[/Script/WDGame.WDGameStateSession]
bLockOverpopulatedTeamsConfig=true
OverpopulatedTeamThresholdConfig=2

[/Script/WDGame.WDServerMapRotationSettings]
bEnabled=true ; RotationMode=Ordered|Random
+RotationEntries=(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear",ZoneAlternator="ZoneAlternator.Factory.Circle")
+RotationEntries=(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")
; Experience=one; Experiences=several joined with +; ZoneAlternator optional.

## Notes
- Check GET /v1/capabilities per server; not all routes are always enabled.
- No published rate limit. Poll gently — every few seconds at most (the official panel refreshes on a 3-5s cadence).
- The bearer token is the full-access RCON password; never ship it to a browser.
- Unofficial. Verify against your own server.
```

## Appendix B — the starter `ServerSettings.ini`, verbatim

```ini
;===========================================================================
;  Wardogs Dedicated Server - ServerSettings.ini (starter template)
;
;  Unofficial starter from https://wardogs.tech/rcon-reference
;  Copy this to your server's config location, edit the values, and restart.
;  Only whitelisted keys are honored; deleted or ";"-commented lines keep
;  their default. Community-maintained - verify against your host's own docs.
;===========================================================================

[/Script/WDGame.WDGameSession]
; Name shown in the server browser.
ServerName=My Wardogs Server

; Join password. Leave empty for an open server.
ServerPassword=

; Join limits. 0 = no restriction.
ServerMinPlayerCash=0
ServerMaxPlayerCash=0
ServerMinPlayerLevel=0
ServerMaxPlayerLevel=0

; Sponsor banner. Must be a 1024x256 PNG/JPEG on the server's image allow-list.
ServerImageURL=

; Reserved slots: a max count, then one +DefaultReservedPlayerIds line per
; SteamID64. The RCON reserve add/remove commands edit these and persist here.
MaxReservedSlots=20
; +DefaultReservedPlayerIds="7656119XXXXXXXXXX"

; Banned players: one +DefaultBannedPlayerIds line per SteamID64.
; The RCON ban/unban commands edit these and persist here.
; +DefaultBannedPlayerIds="7656119XXXXXXXXXX"

[/Script/Engine.GameSession]
; Total player slots (clamped by the developer-set min/max).
MaxPlayers=32

[MatchState.PreMatch.WaitingForPlayers.PlayerCount]
; Players required before pre-match becomes a live match.
MinimumRequiredPlayers=60

[MatchState.Playing.KOTH]
; Seconds between KOTH score ticks (allowed range ~18-30). Faster ticks pay less.
ScorePeriod=24

[/Script/WDGame.WDGameStateSession]
; Team balancing: lock joining an overpopulated team once it leads by the threshold.
bLockOverpopulatedTeamsConfig=true
OverpopulatedTeamThresholdConfig=2

[/Script/WDGame.WDServerMapRotationSettings]
bEnabled=true
RotationMode=Ordered
; One entry per line. Experience="x" for one; Experiences="a+b" for several;
; Lighting is a lighting scenario; ZoneAlternator is optional (omit for default).
+RotationEntries=(Map="Kavkazi",Experience="Bakurani_KOTH_01",Lighting="DayClear")
; +RotationEntries=(Map="Europe",Experiences="Madrid_KOTH_01+KOTH_InfantryOnly",Lighting="DayLateGray")

[/Script/WDRCON.WDRCONSettings]
; The RCON admin listener (used by admin tools). Off by default - enable it to connect.
bEnabled=false

; Bind address. 127.0.0.1 = loopback only, plaintext Password allowed.
; 0.0.0.0 = all interfaces - REQUIRES a TLS cert + key and PasswordHash to start.
BindAddress=127.0.0.1

; RCON admin port (default 7776; or use the -RCONPort= launch argument).
Port=7776

; Plaintext RCON password. If empty, the server generates one each boot and
; writes it to Saved/RCON/ADMIN-PASSWORD.txt.
Password=

; Alternative to plaintext: a pre-hashed password from
;   WardogsServer -GenerateRCONHash=<password>
; PasswordHash takes precedence over Password when both are set.
PasswordHash=""
```
