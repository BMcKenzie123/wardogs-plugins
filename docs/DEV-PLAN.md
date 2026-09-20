# Dev plan

Where this project is, what ships next, and who owns it. Companion to [BLOCKERS.md](BLOCKERS.md) (what
the org must clear) and [ROLES.md](ROLES.md) (who does what). Versions follow [CHANGELOG.md](../CHANGELOG.md).

## Where we are: v2.0 (2026-09-20)

Running on a dedicated box, connected to the live xREALM server, public HTTPS panel with named admin
logins, 44 plugins with live management, 87 tests. The full feature list is in the changelog.

Principles that hold for every version:

- **Zero runtime dependencies.** Node standard library only. A dependency needs a reason in the PR.
- **The RCON password never leaves the box.** Secrets go in through `deploy/set-secret.sh`, never chat, tickets or commits.
- **Every plugin has a test against the mock server.** No plugin merges without one.
- **The panel must survive a restart with no admin noticing.** Sessions, tokens and plugin state persist.

## v2.1: production pass (owner: prod/RBAC dev, see ROLES)

Goal: the panel is safe to hand to a dozen people with different trust levels.

| Item                                                                                                                                                                                                                                                   | Notes                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RBAC.** Roles `owner`, `admin`, `moderator`, `viewer`. Owner: everything incl. plugin config and admin management. Admin: all server actions. Moderator: DM, kick, temp-ban, broadcast, force MOTD; no permanent bans, no config. Viewer: read-only. | Today `ADMIN_USERS` is `name:hash` only. Extend to `name:role:hash` (parse in `src/host/admins.ts`), gate each `act()` case in `src/plugins/admin-panel.ts`, hide controls the role lacks. |
| **Session login** replacing HTTP Basic: a login form, signed cookie (HMAC of a per-install secret), idle timeout, logout. Basic auth stays as a fallback for scripts.                                                                                  | Keeps the CSRF token model. The cookie secret lives in the plugin state like the CSRF token does.                                                                                          |
| **Admin management in the panel** (owner only): add admin, reset password, change role, disable. Writes `ADMIN_USERS` to `.env` the way plugin options are written to `plugins.json`.                                                                  | Needs `.env` in the unit's `ReadWritePaths` (same fix as plugins.json).                                                                                                                    |
| **Rate limiting and lockout** on failed logins, per source IP behind the proxy (`X-Forwarded-For`).                                                                                                                                                    | Log lockouts; surface in the panel's activity view.                                                                                                                                        |
| **Audit of admin actions to a file** (`data/admin-actions.jsonl`: who, what, target, result) and a panel view of it, separate from the game's own audit log.                                                                                           | The log line already exists; this makes it durable and searchable.                                                                                                                         |
| **Backups.** Nightly tar of `data/` and `plugins.json` to a second location; a restore script; a tested restore.                                                                                                                                       | config-backup already snapshots the game config; this covers our own state.                                                                                                                |
| **CI.** GitHub Actions: `npm ci`, `tsc`, `npm test`, prettier check on every PR. Deploy stays manual (`deploy/remote-deploy.sh`).                                                                                                                      | Node 22 and 24 matrix.                                                                                                                                                                     |
| **Alerting.** Uptime monitor on `/healthz`; downtime-alert to Discord once blocker #2 clears.                                                                                                                                                          |                                                                                                                                                                                            |

Definition of done for v2.1: a moderator account cannot permanently ban or change plugin config, a viewer
cannot post anything, five wrong passwords lock an IP for ten minutes, and a restore from backup has been
done once on a scratch box.

## v2.2: the Discord layer (owner: server lead + recruiting lead; bot work: a plugin developer)

The platoon's Discord case ([DISCORD.md](DISCORD.md)) is the spec. Two halves.

**Half one, no code: the server and the feeds.** Depends on blockers #1, #2, #4, #15.

- Build the WARDOGS Discord to the build sheet; `DISCORD_INVITE` on both instances; two feed webhooks.
- Enable and tune per server: discord-relay, downtime-alert, fill-server (rally with a role mention),
  admin-alerts into `#admin-feed`, weekly-recap, prime-time, event-announcer for the weekly slot.
- first-timer (whisper), match-mvp, playtime-ranks: enable with the approved copy.

**Half two, one new plugin: `discord-bot`.** Depends on #3 (bot token). Zero dependencies: Discord's
gateway is a WebSocket and Node 22 has one built in; interactions arrive over the gateway, so no public
endpoint is needed.

| Item                                                                                                                                                                                                                                                                                | Notes                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Read-only commands for anyone:** `/status`, `/players`, `/map`, `/next`, `/queue`.                                                                                                                                                                                                | Answered from the host's last snapshot; no RCON call per command.                                                                                                                          |
| **Permissions from TAW roles.** A `roles` option maps Discord role ids to `viewer` / `moderator` / `admin` / `owner`. Moderator: `/kick`, `/tempban`, `/dm`, `/broadcast`, `/motd`. Admin: `/ban`, `/unban`, `/map`, `/lighting`. Owner: plugin config.                             | A role change on Discord is the permission change; nobody holds a credential. Every command is written to `data/admin-actions.jsonl` under the Discord user, the same file the panel uses. |
| **Member verification.** `/link <steamId>` creates a pending link; an admin confirms with `/verify`, or the player proves ownership by putting a one-time token in their Steam profile name for a minute (the Steam lookup already exists). Linked pairs live in `data/links.json`. | The API cannot read chat, so an in-game code is not an option.                                                                                                                             |
| **Reserved slots by role** on top of verification, once the server build exposes `POST /v1/reserved-slots` (blocker #5).                                                                                                                                                            | Until then: the list of who should have one, applied by hand in the official panel.                                                                                                        |
| **Alerts with actions.** A ban or kick posted to `#admin-feed` carries the reason and the admin; an appeal in `#appeals` can be answered with `/unban` from the same thread.                                                                                                        |                                                                                                                                                                                            |
| **Fleet view.** `/status` covers every instance (NA, EU); a pinned message the bot keeps updated with both servers' state.                                                                                                                                                          | The panels already link to each other; this is the overview.                                                                                                                               |

Definition of done for v2.2: a TAW member with the moderator role can kick and temp-ban from Discord and
the action appears in the admin log under their Discord name; a member without the role gets "not
allowed"; the invite in-game is the WARDOGS Discord; the rally fires when population drops.

## v2.3: quality of life

- Config editor in the panel (`GET`/`PUT /v1/config` with `If-Match`), matching the official panel's LIVE /
  NEXT MATCH / RESTART pips. Only where the build exposes the route.
- Map rotation editor when the build exposes rotation writes (blocker #5).
- Per-plugin log filter in the activity view; a "why did this fire" trace for DM plugins.
- Mobile layout pass on the panel.

## Not planned

- Anything that needs chat (blocker #6): commands, chat moderation, kill feeds.
- Running on the game box. xREALM offers no way to.
- A database. JSON files under `data/` are enough at this scale and keep the zero-dependency rule.

## How to pick something up

1. Take an item from this plan or a blocker with your name on it in ROLES.
2. Branch from `main`, keep the change to one concern, add or extend a test in `src/test/`.
3. `npm test` must be green and `npx prettier --check src` clean.
4. Open a PR against `BMcKenzie123/wardogs-plugins`. Deploys are done by the server lead with
   `deploy/remote-deploy.sh` after review.
