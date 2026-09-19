# wardogs-plugins

A plugin host and `wd` command line for a **WARDOGS** dedicated server, driven over the server's RCON HTTP API.
Built for a server hosted on **xREALM**, but works with any approved host (QONZER, BisectHosting) or a self-hosted box.

TypeScript, ESM, **zero runtime dependencies**. Node 20+ runs the built output; Node 23.6+ runs the `.ts` sources directly.

## Why this runs off-box

WARDOGS has no in-process mod or plugin API. xREALM (like the other hosts) gives you a control panel with file access and
restart schedules, not a way to run your own code on the game box. The only programmable surface is the RCON HTTP API
(`/v1`, one bearer token, TLS on any network-exposed listener).

So this project runs on a machine **you** control: a cheap VPS, a home box, a Raspberry Pi, a container. It polls the
server every few seconds, turns the changes into events (`player.join`, `match.map`, `server.down`, …), and lets
plugins react by calling back into the API (DM a player, kick, broadcast, change lighting, …).

API reference (unofficial): <https://wardogs.tech/rcon-reference> · OpenAPI: <https://wardogs.tech/openapi.json>
Everything on that site, collected and cross-checked, is in [docs/WARDOGS-REFERENCE.md](docs/WARDOGS-REFERENCE.md):
all 35 endpoints, every response field, every config key, known ids, and what the API cannot do.

## Quick start

```bash
git clone <this repo> wardogs-plugins && cd wardogs-plugins
cp .env.example .env            # fill in RCON_HOST / RCON_PORT / RCON_PASSWORD from the xREALM panel
cp plugins.example.json plugins.json
npm install
npm run wd -- status            # if this prints your server, the token and TLS are right
npm run dev                     # start the plugin host (Ctrl-C to stop)
```

Where to find the credentials on xREALM: open the server in the xREALM panel and look for the RCON section
(host, port, password). The password is the bearer token; there is no separate login.

## TLS

Any hosted RCON listener is bound to the network, and the game server refuses to start such a listener without TLS.
Hosts typically present a self-signed certificate. Try strict TLS first; if `wd status` fails with
`SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, pick one:

- **Pin the certificate** (recommended). Export it once and point `RCON_CA_FILE` at it:

  ```bash
  openssl s_client -connect HOST:PORT -showcerts </dev/null 2>/dev/null | openssl x509 > rcon-ca.pem
  ```

  Then set `RCON_CA_FILE=./rcon-ca.pem`. If the host rotates its cert, re-export.

- **Skip verification** with `RCON_TLS_INSECURE=1`. Only affects this client (no global `NODE_TLS_REJECT_UNAUTHORIZED`).

`RCON_SCHEME=http` is only valid for a loopback listener on the same machine as the game server. It will not work
against xREALM.

## Plugins

Enable and configure plugins in `plugins.json` (see `plugins.example.json` for every option with its default).
Each key is a plugin name; `"enabled": true` turns it on; the rest are that plugin's options.

| Plugin            | What it does                                                                                          | Key options                                                                                | Needs route              |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| `welcome`         | DMs a player a few seconds after they join; different text for returning players                      | `message`, `returningMessage`, `delayMs`, `rememberPlayers`                                | —                        |
| `motd`            | Broadcasts rotating messages on an interval while players are online                                  | `messages[]`, `intervalMinutes`, `minPlayers`                                              | —                        |
| `discord-relay`   | Posts up/down, map change, joins/leaves, audit entries and a periodic scoreboard to a Discord webhook | `webhookUrl` (or `DISCORD_WEBHOOK_URL`), `events[]`, `scoreEveryMinutes`                   | —                        |
| `ping-guard`      | Warns then kicks players whose ping stays above a limit; reserved slots exempt                        | `maxPingMs`, `warnAfterPolls`, `kickAfterPolls`, `exemptReserved`, `exemptSteamIds[]`      | —                        |
| `team-balance`    | Warns when factions are uneven; optionally moves the newest player on the big team                    | `threshold`, `autoMove`, `cooldownSeconds`, `warnMessage`                                  | `PATCH /v1/players/{id}` |
| `stats-logger`    | Appends player snapshots and per-session summaries to `data/stats/YYYY-MM-DD.jsonl`                   | `snapshotEveryPolls`                                                                       | —                        |
| `audit-tail`      | Logs each new admin-action audit entry; optionally to `data/audit.jsonl`                              | `toFile`                                                                                   | —                        |
| `empty-server`    | After N empty minutes, resets to a "home" map / lighting once                                         | `afterMinutes`, `map`, `experiences[]`, `lighting`                                         | —                        |
| `ban-sync`        | Mirrors a shared ban list (file or URL) onto the server                                               | `source`, `intervalMinutes`, `removeUnlisted`                                              | —                        |
| `lighting-clock`  | Sets lighting by wall-clock schedule (uses `TZ`)                                                      | `schedule[{from,lighting}]`                                                                | —                        |
| `seed-thanks`     | DM or broadcast a thank-you to players seeding an under-populated server                              | `belowPlayers`, `mode`, `afterMinutes`, `oncePerHours`, `broadcastEveryMinutes`, `message` | —                        |
| `recruit-pitch`   | DMs a recruiting pitch once a player has put real time into a session                                 | `afterMinutes`, `minKills`, `repeatAfterDays`, `message`                                   | —                        |
| `regulars`        | Visit and play-time tracking, milestone DMs, `data/regulars.json` leaderboard                         | `tiers[{visits,message}]`, `delayMs`, `leaderboardFile`                                    | —                        |
| `match-mvp`       | End-of-match top-player shout-out and an MVP DM                                                       | `top`, `minPlayers`, `broadcast`, `mvpMessage`                                             | —                        |
| `fill-server`     | Discord rally (and in-game nudge) when the server is under-populated                                  | `belowPlayers`, `cooldownMinutes`, `message`, `connectInfo`, `quietHours`, `broadcast`     | —                        |
| `event-announcer` | In-game and Discord reminders for recurring events                                                    | `events[{day,time,name,message}]`, `remindMinutesBefore[]`, `discord`                      | —                        |

### More plugins: moderation, match, stats, ops

| Plugin                    | What it does                                                                                     | Key options                                                            | Needs               |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------- |
| `reserved-slot-reward`    | Grants a reserved slot at N visits and DMs the player                                            | `visits`, `message`                                                    | —                   |
| `comeback`                | DMs a player who returns after N days away                                                       | `awayDays`, `delayMs`, `message`                                       | —                   |
| `kill-streak`             | Broadcasts when a player hits kill milestones within a match                                     | `thresholds[]`, `message`                                              | —                   |
| `first-timer`             | Public welcome broadcast for a never-seen steamId                                                | `message`                                                              | —                   |
| `playtime-ranks`          | Broadcasts rank-ups by total hours played                                                        | `ranks[{hours,title}]`, `announce`                                     | —                   |
| `discord-announce-bridge` | Broadcasts new posts from a Discord channel in-game                                              | `channelId`, `intervalSeconds`, `prefix`, `ignoreBots`                 | `DISCORD_BOT_TOKEN` |
| `prime-time`              | Posts to Discord once the server crosses N players                                               | `atPlayers`, `oncePerHours`, `message`                                 | webhook             |
| `name-filter`             | DMs then kicks players whose name matches a regex list                                           | `patterns[]`, `kickReason`, `dmBeforeKick`                             | —                   |
| `afk-kick`                | Warns then kicks idle players when the server is nearly full                                     | `afterMinutes`, `onlyWhenAbove`, `warnMinutesBefore`, `exemptReserved` | —                   |
| `temp-bans`               | Lifts bans placed with `wd tempban` when they expire                                             | `checkSeconds`                                                         | —                   |
| `vac-check`               | Flags or kicks VAC / game-banned accounts                                                        | `action`, `minGameBans`, `kickReason`                                  | `STEAM_API_KEY`     |
| `new-account-gate`        | Flags or kicks Steam accounts younger than N days                                                | `minAccountDays`, `action`, `kickUnknown`                              | `STEAM_API_KEY`     |
| `admin-alerts`            | Posts selected audit-log actions to Discord                                                      | `events[]`, `ignorePeers[]`                                            | webhook             |
| `rotation-scheduler`      | Replaces the map rotation by weekday and time window                                             | `schedules[{days,from,to,entries}]`, `checkSeconds`                    | —                   |
| `population-maps`         | Switches to a size-appropriate map just after a match starts                                     | `tiers[{maxPlayers,maps}]`, `graceSeconds`                             | —                   |
| `stale-match`             | Ends a match that has run longer than N minutes                                                  | `maxMinutes`                                                           | —                   |
| `weather-randomizer`      | Random lighting each new match, optionally weighted                                              | `lightings[]`, `weights[]`, `excludeCurrent`                           | —                   |
| `score-tick-tuner`        | Adjusts the score tick to the player count                                                       | `table[{upToPlayers,scoreTick}]`, `cooldownSeconds`                    | —                   |
| `sponsor-rotator`         | Cycles sponsor banner images (1024×256; only catbox.moe / imgbb.com / postimg.cc links are sent) | `imageUrls[]`, `everyHours`                                            | —                   |
| `config-backup`           | Saves every new config revision to `data/config/` with a line diff summary                       | `checkMinutes`, `keep`                                                 | —                   |
| `weekly-recap`            | Weekly Discord post: top killers, playtime, busiest hours                                        | `day`, `time`, `top`                                                   | webhook             |
| `leaderboard`             | Writes `data/leaderboard.json` from the stats files; optional Discord post                       | `everyMinutes`, `top`, `postEveryHours`                                | —                   |
| `steam-profiles`          | Caches Steam names, avatars and countries to `data/profiles.json`                                | `refreshHours`                                                         | `STEAM_API_KEY`     |
| `prometheus-metrics`      | `/metrics` for Prometheus and Grafana                                                            | `path`                                                                 | `HTTP_PORT`         |
| `web-dashboard`           | One-page HTML status: players, leaderboard, regulars, hourly load                                | `path`                                                                 | `HTTP_PORT`         |
| `health-endpoint`         | `/healthz` for uptime monitors (503 when polls go stale)                                         | `path`, `staleAfterPolls`                                              | `HTTP_PORT`         |
| `downtime-alert`          | Discord alert only if the server stays down N minutes, plus a recovery note                      | `afterMinutes`, `recoveredMessage`                                     | webhook             |

Plugins marked `HTTP_PORT` share one listener on that port. `temp-bans` pairs with the CLI:
`wd tempban <steamId> 3d reason` bans now and records the expiry, `wd tempbans` lists them.

Template strings accept `{name}`, `{steamId}`, `{server}`, `{players}`, `{max}` (plus plugin-specific extras such as
`{maxPingMs}` and `{ping}` in ping-guard, `{a}` / `{b}` in team-balance).

The host checks `GET /v1/capabilities` at startup and skips any plugin whose required route the server does not
expose, with a warning in the log.

### Recruiting kit

The RCON API can push messages and see who is on, but it cannot read chat. Recruiting here therefore means
well-timed nudges and pulling your Discord onto the server, not `!join` commands. Five plugins cover it:

| Plugin            | Recruiting job                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recruit-pitch`   | After a player has put N minutes into a session, DM the pitch once; re-pitch after N days                                                            |
| `regulars`        | Count visits and play time, DM milestone messages ("3rd visit, join the clan"), and write `data/regulars.json` so you can see who to approach        |
| `match-mvp`       | At the end of each match, broadcast the top players and DM the MVP a personal invite                                                                 |
| `fill-server`     | When population drops below N, rally your Discord with a join message and nudge current players to invite friends; cooldown and quiet hours built in |
| `event-announcer` | Remind players in-game and on Discord about recurring events (clan night, training) at T-60, T-15 and start                                          |
| `seed-thanks`     | Thank players who seed an under-populated server: a DM after N minutes of seeding, or a periodic broadcast while it fills                            | `belowPlayers`, `mode`, `afterMinutes`, `oncePerHours` |

A new player's first evening then looks like: `welcome` at +6 s, `recruit-pitch` at +15 min, a `match-mvp` shout-out
if they top the board, and `regulars` milestones on later visits. Every message is a template in `plugins.json`;
replace `discord.gg/your-invite` everywhere before enabling.

### Events plugins can subscribe to

| Event                          | Fires when                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `tick`                         | every successful poll (`{ snapshot, previous }`)                                                       |
| `server.up` / `server.down`    | the RCON API becomes reachable / unreachable (once per transition)                                     |
| `player.join` / `player.leave` | a steamId appears / disappears between polls (`leave` carries `sessionSeconds` and final kills/deaths) |
| `match.map`                    | map, experiences or zone alternator changed                                                            |
| `match.new`                    | `matchSeconds` went backwards (restart or next match)                                                  |
| `match.lighting`               | lighting preset changed                                                                                |
| `score.changed`                | any `factionScores` row changed                                                                        |
| `audit.entry`                  | a new entry appeared in `GET /v1/audit` (chronological order; polled only if something subscribes)     |

The first poll after startup or after an outage is a **baseline**: it does not emit join/leave/map events for
whatever changed while the host was not watching.

### Writing a plugin

Create `src/plugins/my-plugin.ts`, register it in `src/host/registry.ts`, and enable it in `plugins.json`.

```ts
import { definePlugin } from '../host/plugin.ts';

interface Options {
  minKills: number;
}

export default definePlugin<Options>({
  name: 'first-blood',
  description: 'Congratulates the first player to reach N kills each match',
  defaults: { minKills: 10 },
  setup(ctx) {
    let done = false;
    ctx.on('match.new', () => {
      done = false;
    });
    ctx.on('tick', async ({ snapshot }) => {
      if (done) return;
      const hero = snapshot.players.find((p) => p.kills >= ctx.options.minKills);
      if (!hero) return;
      done = true;
      await ctx.rcon.broadcast(`${hero.name} hit ${ctx.options.minKills} kills first!`);
    });
  },
});
```

The context gives you `ctx.rcon` (typed client for every endpoint), `ctx.on(event, handler)`, `ctx.every(ms, fn)`,
`ctx.snapshot()` (latest status + players, or `null` while the server is unreachable), `ctx.state` (a persisted JSON key/value store under `data/state/`),
`ctx.hasRoute(method, path)`, `ctx.options`, and `ctx.log`. Handler errors are caught and logged; one broken
plugin never takes the host down.

## CLI cheat-sheet

`npm run wd -- <command>` during development, or `npm run build && npm link` to get a global `wd`.

```
wd status | players | caps | bans | slots | audit [n] | rotation | maps | lightings | experiences [map] | alternators <map>
wd watch                                   # one status line per poll
wd broadcast <msg…>      wd dm <steamId> <msg…>
wd kick <steamId> [why]  wd kill <steamId>    wd faction <steamId> <faction>
wd ban <steamId> [why]   wd unban <steamId>   wd slot add|rm <steamId>
wd tempban <steamId> 30m|12h|3d|2w [why]   wd tempbans
wd map <map> [--exp A+B] [--lighting X] [--alt Y]     wd lighting <preset>     wd end | restart
wd rotation add <map> [...] | rm <i> | move <i> up|down | save
wd settings [--score-tick N] [--rotation on|off] [--mode ordered|random]
wd config get > ServerSettings.ini         # edit, then:
wd config validate ServerSettings.ini
wd config put ServerSettings.ini [--force] [--full-apply]   # sends If-Match; exit 2 on a revision conflict
wd sponsor [imageUrl]
```

Add `--json` to any command for raw output (pipe into `jq`).

## Hosting the host

Anything that can run Node 20+ and reach the RCON port works. Three ready-made options:

**systemd (Linux VPS)**

```bash
sudo useradd -r -s /usr/sbin/nologin wardogs
sudo git clone <this repo> /opt/wardogs-plugins && cd /opt/wardogs-plugins
sudo cp .env.example .env && sudo nano .env && sudo chmod 600 .env
sudo cp plugins.example.json plugins.json
sudo chown -R wardogs:wardogs /opt/wardogs-plugins
sudo ./deploy/install.sh           # npm ci, build, install + start the unit
journalctl -u wardogs-plugins -f   # logs
```

**Docker**

```bash
docker compose up -d --build       # uses .env, mounts ./data and ./plugins.json
docker compose logs -f
```

**PM2**

```bash
npm ci && npm run build
pm2 start dist/index.js --name wardogs-plugins && pm2 save
```

## Security

The RCON password is a **full-access** token: it can kick, ban, replace the config, and end matches. Keep `.env`
mode `0600`, never put the token in a browser page or a public repo, and prefer pinning the cert over
`RCON_TLS_INSECURE=1` so a network-level impostor cannot harvest it.

## Troubleshooting

| Symptom                                                 | Likely cause                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `401` on every call                                     | Wrong `RCON_PASSWORD` (it is the panel's RCON password, not the join password)                                     |
| `TIMEOUT` / `ECONNREFUSED`                              | Wrong host/port, RCON listener disabled in the panel, or a firewall in front of the port                           |
| `SELF_SIGNED_CERT_IN_CHAIN` and friends                 | See **TLS** above                                                                                                  |
| `skipping team-balance; missing PATCH /v1/players/{id}` | That server build does not expose the route; `wd caps` shows what it has                                           |
| Everyone gets a welcome DM on restart                   | They should not: the first poll is a baseline. If it happens, check the log for a `server.down` / `server.up` flap |
| Discord posts arrive late                               | The relay sends at most one post per second and drops beyond a 50-item backlog                                     |

## Development

Design notes and the original build contract live in [docs/SPEC.md](docs/SPEC.md).

```bash
npm run dev          # run the host from source (Node 24: no build step)
npm run check        # typecheck + tests (in-process mock RCON server, no network)
npm run format       # prettier
npm run build        # emit dist/ for Node 20+
```
