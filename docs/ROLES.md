# Role assignments

Who owns what for the TAW WARDOGS NA server. A blocker or plan item with no name on it does not move;
put a handle next to it. Handles are Discord/TAW names; panel logins are separate (see Admin logins).

| Role                    | Who                     | Owns                                                                                                                                            | First thing to do                                                                                                                                 |
| ----------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server lead**         | Brogan (`bqmck`)        | Decisions: rules, event slot, copy sign-off. Secrets on the box. Deploys. Final say on the dev plan.                                            | Approve or edit [COPY.md § Rules](COPY.md#rules-draft) (blocker #1) and pick the weekly slot (blocker #4).                                        |
| **Prod / RBAC dev**     | _assign_                | [DEV-PLAN.md v2.1](DEV-PLAN.md#v21-production-pass-owner-prodrbac-dev-see-roles): roles, session login, admin management, lockout, backups, CI. | Read `src/host/admins.ts` and the `act()` switch in `src/plugins/admin-panel.ts`; open a PR that adds a role field to `ADMIN_USERS`.              |
| **Recruiting lead**     | _assign_                | Blocker #2 and #3: the Discord channel, webhook and bot for this server. The recruiting copy after v2.0. Funnel numbers.                        | Create the channel and webhook in the TAW Discord; hand the URL to the server lead to enter with `deploy/set-secret.sh` (never paste it in chat). |
| **Seeding crew**        | _assign (2+ people)_    | Being on the server at the agreed slot so it is never empty when a new player looks. Reporting what new players ask.                            | Agree a slot with the server lead; it becomes the event-announcer entry.                                                                          |
| **Admins (moderation)** | `jdam`, `ralf`, `bqmck` | Day-to-day: kicks, bans, DMs, force MOTD, toggling plugins. Everything they do is logged under their own login.                                 | Sign in at the panel with your own name; if a password is missing, ask the server lead (rotate with `wd admin-hash <name>`).                      |
| **Plugin developers**   | anyone in the org       | New plugins and fixes, by PR, with a test. See [DEV-PLAN.md](DEV-PLAN.md#how-to-pick-something-up).                                             | `git clone`, `npm ci`, `npm test`. Read `docs/WARDOGS-REFERENCE.md` before touching the RCON client.                                              |

## Admin logins

Named logins live in `ADMIN_USERS` on the box as scrypt hashes; the panel never sees a plaintext password
after creation. Today: `bqmck`, `jdam`, `ralf`. Until v2.1 ships RBAC, every login has the same power:
treat the panel login as the RCON password itself and share it accordingly.

## Escalation

- Server or panel down: server lead. Check `https://<panel-host>/healthz` first; 503 means polls are stale.
- A player needs a permanent ban: any admin; note the reason in the ban (it shows in the panel and the audit log).
- The game server itself (crash loop, restart, config file): the xREALM panel, server lead only.

## Cadence

- **Weekly, 10 minutes:** server lead + recruiting lead walk BLOCKERS.md top to bottom. Anything with no owner
  gets one or gets struck.
- **Per release:** CHANGELOG.md updated in the same PR as the change; version bumped in `package.json`.
