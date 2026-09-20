# Changelog

All notable changes to wardogs-plugins. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow semver. Dates are the day the change reached the live TAW WARDOGS NA server.

## [Unreleased]

### Added

- **More than one game server per box.** `deploy/add-instance.sh <name> <port>` creates `instances/<name>/`
  (own `.env`, `plugins.json`, `data/`), a `wardogs-plugins@<name>` service from the new template unit, and
  Caddy routes for `/<name>/admin` and `/<name>/healthz`. `deploy/set-secret.sh <KEY> <name>` targets an
  instance; `install.sh` restarts every instance after a rebuild. The EU server runs this way.
- **Server switcher** in the panel: admin-panel options `label` and `otherPanels` link the panels to each other.
- motd: the cadence survives restarts and saves (next line due relative to the last send); every send is logged.
- Copy: in-game lines say "TAW WARDOGS NA" instead of expanding `{server}` to the full browser title.

## [2.0.0] - 2026-09-20

The management release: the panel goes from a dashboard with toggles to the place the server is run from,
and the project gets a plan, a blockers list and role assignments so the org can push it forward.

### Added

- **Custom admin panel, full management.** Every plugin has a Configure drawer: options rendered by type
  (number, boolean, text, one-per-line list, JSON for tiers), dropdowns for fixed-choice options, the default
  shown beside customized values. Save & apply writes only the overrides to `plugins.json` and restarts that one
  plugin in place; Reset and Restart per plugin. Bad input is rejected with the field named.
- **Force MOTD.** A Server card listing the motd lines, preselected to the next in rotation, with Send now.
- **Steam names and avatars** for every SteamID on the panel (players, bans, reserved slots) when `STEAM_API_KEY`
  is set; one batched lookup, cached an hour, never holds the page up.
- **In-place live updates.** The page fetches itself every 8 s and swaps only the sections that changed. A
  section with a focused or half-typed field, or an open drawer, is left alone. No reload, no scroll jump.
- **Whisper mode** (`mode: dm`) for first-timer, kill-streak and playtime-ranks; `Plugin.choices` for
  dropdown options; shared `src/host/say.ts`.
- **Sessions survive restarts.** The host checkpoints who is on and since when to `data/sessions.json` and
  restores it after a restart or short outage; `player.leave` carries `observedSeconds`.
- **Live play time.** regulars and playtime-ranks credit time every poll; the leaderboard and regulars tables
  include the session in progress and mark players who are on now.
- **Public-URL fixes.** Same-origin guard accepts `Origin: null` (what browsers send behind a
  `Referrer-Policy: no-referrer` proxy) and `X-Forwarded-Host`; Caddy now sends `same-origin`. GET on the action
  URL redirects to the panel. Unrouted requests are logged.
- **Docs:** [docs/DEV-PLAN.md](docs/DEV-PLAN.md), [docs/BLOCKERS.md](docs/BLOCKERS.md),
  [docs/ROLES.md](docs/ROLES.md), [docs/COPY.md](docs/COPY.md) (the v2.0 player-facing copy pack, applied live).
- Tests: 87 (from 69), covering option editing, persistence failure, CSRF across restarts, origin rules,
  audit noise, sessions across restarts, single socket, whisper modes, Steam identities, the MOTD card.

### Changed

- **One RCON socket.** The client queues every request on a single keep-alive connection, so the game's audit
  log sees one source port instead of one per parallel call.
- **Audit noise filtered.** audit-tail and discord-relay skip the server's connection/auth bookkeeping and
  read-only calls (this host's own polling); admin-alerts matches its filter words against the route detail.
- The CSRF token persists in the plugin's state, so deploys no longer invalidate open panel tabs; a stale page
  redirects with an explanation instead of a bare 403.
- Persistence failures are reported to the admin ("applied but NOT saved") instead of logged and swallowed.
- leaderboard rebuilds a few seconds after any session ends, not only every 30 minutes.
- The hourly chart names its time zone.

### Fixed

- Panel saves silently failed on the box: the hardened unit had `plugins.json` read-only. The unit now grants
  it, so toggles and option edits persist across restarts.
- Every form post through the public URL was refused as cross-origin (see Added, public-URL fixes).
- Auto-refresh no longer reloads the page every 30 s, jumps to the top and collapses open drawers.
- population-maps compares against the rotation's current entry, since `status.map` reports level names.
- Plugins whose routes the live build lacks are skipped with a note instead of failing at run time.

## [1.1.0] - 2026-09-20

### Added

- admin-panel plugin: all-in-one web admin behind Basic auth, dark TAW theme, Automation section with
  runtime plugin toggles.
- Named admin logins (`ADMIN_USERS`, scrypt hashes, `wd admin-hash`).
- Deployment: `deploy/bootstrap.sh`, `install.sh`, `remote-deploy.sh`, `harden-ssh.sh`, `set-secret.sh`,
  `public-url.sh` (Caddy with Let's Encrypt), hardened systemd unit.
- seed-thanks plugin.
- Host starts without capabilities and re-checks route requirements when the server answers.

## [1.0.0] - 2026-09-13

### Added

- Initial release: WARDOGS RCON plugin host, `wd` CLI, event model (poll diffing), per-plugin state,
  recruiting kit.
- 27 more plugins: moderation, match control, stats, ops, Discord and Steam integrations (44 total).
- `docs/WARDOGS-REFERENCE.md`: everything on wardogs.tech, cross-checked.
- Sponsor image host whitelist enforcement.

[2.0.0]: https://github.com/BMcKenzie123/wardogs-plugins/compare/c511510...main
[1.1.0]: https://github.com/BMcKenzie123/wardogs-plugins/compare/bf5ed01...c511510
[1.0.0]: https://github.com/BMcKenzie123/wardogs-plugins/commits/bf5ed01
