# The WARDOGS Discord server

A separate Discord server for the TAW WARDOGS game servers, not channels inside the main TAW Discord.
Why separate: players who get banned, harassed or curious should not have to join the members' Discord
to reach an admin; the server feed and rally posts belong next to the people who play, not in a
battalion's general chat; and a public-facing server can have its own verification and moderation
settings without touching TAW's.

This page is the build sheet. Whoever creates the server works down it; the result is one invite link
that goes into `DISCORD_INVITE` on the box and appears in every in-game message.

## Server settings

| Setting               | Value                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Name                  | TAW WARDOGS                                                                                                           |
| Icon / banner         | The TAW WARDOGS banner artwork (same as the server row)                                                               |
| Verification level    | **Medium** (registered on Discord for 5+ minutes). Blocks throwaway accounts without blocking new players.            |
| Explicit media filter | Scan all members                                                                                                      |
| Default notifications | Only @mentions                                                                                                        |
| Community features    | On (enables rules screening, welcome screen, the report button)                                                       |
| Rules screening       | On, using the rules below; a member must accept before posting                                                        |
| Invite                | One permanent, no-expiry invite from `#welcome`. Vanity URL later if the server reaches Community level requirements. |
| 2FA for moderation    | Required                                                                                                              |

## Channels

| Channel       | Who can see | Who can post                      | Purpose                                                                                              |
| ------------- | ----------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `#welcome`    | everyone    | admins                            | Pinned: what this is, the invite, the two game servers, how to connect, the rules link.              |
| `#rules`      | everyone    | admins                            | The rules (below) and the privacy notice (below).                                                    |
| `#appeals`    | everyone    | everyone, slow mode 1 msg / 5 min | Ban appeals. Pinned template: SteamID64, in-game name, when, what the ban reason said, your account. |
| `#reports`    | everyone    | everyone, slow mode               | Report a player: who, when, what, screenshots. Admins reply in thread.                               |
| `#server-na`  | everyone    | webhook only                      | The NA server's feed: up/down, joins, map changes, rally posts, weekly recap.                        |
| `#server-eu`  | everyone    | webhook only                      | The EU server's feed.                                                                                |
| `#general`    | everyone    | everyone                          | Chat. Recruiting happens here by being decent, not by pitching.                                      |
| `#lfg`        | everyone    | everyone                          | "Anyone on tonight?" Seeding crew posts their slot here.                                             |
| `#admin-feed` | admins      | webhook only                      | Every kick and ban as it happens (admin-alerts), with the admin's name.                              |
| `#admin-chat` | admins      | admins                            | Coordination. Appeals are discussed here, answered in `#appeals`.                                    |

## Roles

| Role      | Who                                  | Can                                                                                |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| Owner     | server lead (Brogan)                 | everything                                                                         |
| Admin     | the panel admins (jdam, ralf, bqmck) | manage messages, timeout/kick/ban Discord members, see `#admin-*`, manage webhooks |
| Moderator | trusted regulars                     | manage messages, timeout members, see `#admin-feed` (read)                         |
| TAW       | TAW members                          | a tag; no extra permissions                                                        |
| Player    | everyone after rules screening       | post in the public channels                                                        |

Keep "manage server" and "manage roles" with the owner only.

## Webhooks

Two webhooks, one per feed channel, created under Server Settings → Integrations → Webhooks. Name them
"WARDOGS NA" and "WARDOGS EU" with the banner as avatar. The URLs go to the server lead **privately** (Discord
DM to the lead, then delete), never in a channel or a chat with a bot, and onto the box with:

```bash
ssh -t wardogs-box "sh /opt/wardogs-plugins/deploy/set-secret.sh DISCORD_WEBHOOK_URL"
```

```bash
ssh -t wardogs-box "sh /opt/wardogs-plugins/deploy/set-secret.sh DISCORD_WEBHOOK_URL eu"
```

A third webhook on `#admin-feed` is the `webhookUrl` option of the admin-alerts plugin (set it in the panel's
Configure drawer for admin-alerts on each server). Then enable, per server: discord-relay, downtime-alert,
fill-server, admin-alerts, weekly-recap.

## The invite

Once the permanent invite exists (for example `discord.gg/wardogs`), it becomes the one Discord reference
in every in-game line via `{discord}`:

```bash
ssh -t wardogs-box "sh /opt/wardogs-plugins/deploy/set-secret.sh DISCORD_INVITE"
```

```bash
ssh -t wardogs-box "sh /opt/wardogs-plugins/deploy/set-secret.sh DISCORD_INVITE eu"
```

Type the invite without `https://` (it reads better in-game). Both services restart and every welcome DM,
MOTD line, pitch and ban reason switches at once. Until then `DISCORD_INVITE` is `discord.gg/taw`.

## Pinned text

### `#rules` (also the rules-screening text)

1. **Play fair.** No cheats, exploits or glitch abuse. Permanent ban.
2. **No harassment.** No slurs, hate or targeting people, in-game or here. Kick, then ban.
3. **No griefing.** No team-killing on purpose, no blocking spawns or vehicles, no mic or chat spam.
4. **Respect admins.** They are volunteers. Disagree in `#appeals`, not in their face.
5. **New players are welcome here.** Help them or leave them alone.

Banned? Post in `#appeals`. Saw something? Post in `#reports`. An admin answers within 24 hours.

### Privacy notice (below the rules)

The TAW WARDOGS game servers keep, per player: your SteamID, in-game name, public Steam name and avatar,
session times, kills and deaths per session, visit counts, and any ban or admin action about you with its
reason. This is used only to run and moderate the servers and to lift temporary bans. Nothing is sold or
shared beyond Steam (name lookups) and this Discord (server feeds). Stats are kept 90 days, admin actions one
year, bans until lifted. Ask in `#appeals` to see what is held about you or to have it removed; an active ban
stays on record.

### `#appeals` pinned template

```
SteamID64:
In-game name:
Which server (NA / EU):
When were you banned (date, time, timezone):
What did the ban reason say:
What happened, in your words:
```

### `#reports` pinned template

```
Who (in-game name, SteamID if you have it):
Which server (NA / EU):
When (date, time, timezone):
What happened:
Screenshots / clips:
```

## Checklist

- [ ] Server created with the settings above, banner set, verification Medium, rules screening on
- [ ] Channels and roles as listed; `#server-*` and `#admin-feed` locked to webhooks
- [ ] Permanent invite created and pasted into `#welcome`
- [ ] `DISCORD_INVITE` set on both instances (blocker #16)
- [ ] Two feed webhooks set on the box (blocker #2); admin-feed webhook set in admin-alerts
- [ ] Rules, privacy notice and the two templates pinned
- [ ] Admins have the Admin role and 2FA
- [ ] Appeals answered by a named admin within 24 h (blocker #15)

## The case made to TAW

The request as put to TAW leadership (2026-09-20), kept here so the build matches the promise:

> The main reason we would like a dedicated Discord channel for the War Dogs platoon is to give us a
> centralized place for server operations, member support, automation, and platoon notifications.
>
> Server ban appeals · Server administration integration · TAW rank-based permissions · Better credential
> security · Audit trail · Automated server alerts · Event notifications · Server seeding · Automated
> seeding notifications · Reserved-slot management · Member verification · Whitelist automation ·
> Centralized support · Reduced administrative workload · Faster incident response · Consistent
> permissions · Easier onboarding/offboarding · Bot commands for server information · Event/server
> integration · Less fragmentation · Future automation.
>
> The intent would not be to replace existing TAW communication channels or bypass the established chain
> of command. The channel would primarily act as an operational extension for the War Dogs platoon,
> allowing us to securely integrate server management, automation, notifications, and member support
> while keeping permissions aligned with the existing TAW rank structure.

## Proposal items and where they stand

| Proposal item                                                              | Status                                                                                                                                                                                                                                                                                                                                                  | Needs                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Server ban appeals                                                         | Every ban carries the appeal path; `#appeals` and a pinned template are in the build sheet; admins answer within 24 h.                                                                                                                                                                                                                                  | the server (#2)                                 |
| Centralized support, less fragmentation                                    | `#reports`, `#appeals`, `#lfg`, `#general` as laid out above.                                                                                                                                                                                                                                                                                           | the server (#2)                                 |
| Automated server alerts                                                    | Built: discord-relay (up/down, joins, map changes), downtime-alert (down N min, recovery), admin-alerts (kicks/bans), prime-time (high population). Off until a webhook exists.                                                                                                                                                                         | webhook (#2)                                    |
| Automated seeding notifications                                            | Built: fill-server posts a rally when population drops below a threshold, with a cooldown and quiet hours.                                                                                                                                                                                                                                              | webhook (#2)                                    |
| Server seeding (ping members)                                              | `#lfg` plus the rally post; a role mention in the rally is a one-line option change.                                                                                                                                                                                                                                                                    | webhook (#2)                                    |
| Event notifications, event/server integration                              | Built: event-announcer (in-game and Discord reminders). Map and lighting changes ahead of an event work today; reserved slots and passwords depend on the server build (blocker #5).                                                                                                                                                                    | webhook (#2), a schedule (#4)                   |
| Audit trail                                                                | Built: every panel action is recorded with admin, target, reason and outcome (`data/admin-actions.jsonl`); `#admin-feed` mirrors it live.                                                                                                                                                                                                               | webhook (#2) for the feed                       |
| Bot commands for server information                                        | Planned: `/status`, `/players`, `/map`, `/next`, read-only, anyone.                                                                                                                                                                                                                                                                                     | bot (#3), dev plan v2.2                         |
| TAW rank-based permissions, consistent permissions, onboarding/offboarding | Planned: the bot reads rank, unit and status from the **main TAW API** and maps rank to command permissions (viewer / moderator / admin / owner); a rank change in TAW is the permission change. Fallback without API access: mirror the main TAW Discord's roles, or roles the CoC assigns on this server. The panel keeps its own logins for the box. | bot (#3), **main TAW API (#17)**, dev plan v2.2 |
| Better credential security                                                 | Already true for the box: the RCON password lives only there, entered by silent prompt. The bot extends it: members act through the bot, never with a credential.                                                                                                                                                                                       | bot (#3)                                        |
| Reduced workload, faster incident response                                 | Planned: `/kick`, `/tempban`, `/broadcast`, `/motd` for moderators and up, answered in the channel with the outcome.                                                                                                                                                                                                                                    | bot (#3), dev plan v2.2                         |
| Member verification (Discord to Steam)                                     | Planned: where TAW's member record holds Discord and Steam ids (main TAW API), the link is automatic and authoritative. Otherwise `/link <steamId>` plus an admin `/verify`, or a one-time token in the Steam profile name. An in-game code is not possible: the game's API cannot read chat.                                                           | bot (#3), **main TAW API (#17)**, dev plan v2.2 |
| Reserved-slot management by role                                           | Planned on top of verification; needs `POST /v1/reserved-slots`, which this server build does not expose.                                                                                                                                                                                                                                               | bot, verification, host build (#5)              |
| Whitelist automation                                                       | Not possible: the RCON API has no whitelist endpoint. Reserved slots are the closest thing.                                                                                                                                                                                                                                                             | platform                                        |
| Future automation                                                          | The bot is one plugin in this host; a new command is a new handler with a test.                                                                                                                                                                                                                                                                         |                                                 |
