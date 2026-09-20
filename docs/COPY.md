# Player-facing copy

Every line the server says to players, in one place. Voice: a unit that is glad you showed up, not a
billboard. Short sentences. One ask per message. Every message either makes the player feel seen or
gives them one concrete next step, never both in the same breath.

Rules of thumb:

- **Under 140 characters** for broadcasts and DMs. In-game text has no wrap control, and nobody reads a
  paragraph mid-firefight.
- **discord.gg/taw is the only link.** One destination, always the same.
- **No exclamation stacking, no emoji, no all-caps.** The unit name carries the weight.
- **Placeholders** are per plugin and listed with each line. A typo in a placeholder prints literally.
- **Do not use `{server}` in-game.** It expands to the full browser title ("[TAW] The Art of Warfare | NA Central #1 | New Player Friendly"), 60 characters before the message starts. Write "TAW WARDOGS NA". `{server}` is fine in Discord posts.

Edit any line in the panel: Automation → the plugin → Configure → Save & apply.

## MOTD rotation (`motd`, one line every 15 min while anyone is on)

| #   | Line                                                                                                    | Job                  |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | TAW WARDOGS NA: the new-player-friendly WARDOGS server. Squad up with us on Discord: discord.gg/taw     | who we are, the link |
| 2   | Rules here are simple: play fair, no cheating, no harassment, no griefing. Admins are in discord.gg/taw | rules (pending #1)   |
| 3   | Good games need players. Bring one friend tonight and this server fills twice as fast.                  | the invite ask       |
| 4   | Want a reserved slot and a squad that shows up every night? That is what TAW is. discord.gg/taw         | the recruiting ask   |
| 5   | Seeding right now? Thank you. Every player here makes the next one more likely. Stick around.           | seeding morale       |

Rotation order matters: welcome, rules, invite, recruit, thanks. Line 2 changes once the rules are approved.

## Welcome (`welcome`, DM 6 s after a join)

- **message** `{server} {name} {players} {max}`:
  `Welcome to TAW WARDOGS NA, {name}. {players}/{max} on right now. New here? Say hi in chat. Discord: discord.gg/taw`
- **returningMessage** `{name}`:
  `Welcome back, {name}. Good to see you again. Discord: discord.gg/taw`

## First visit (`first-timer`, whisper, off until approved)

- **message** `{name} {server}`:
  `First time here, {name}? Welcome to TAW WARDOGS NA. Ask anything in chat. This server is run for new players too.`

## Seeding thanks (`seed-thanks`, DM after 15 min on an under-populated server)

Your original line, kept as written:
`Thank you for seeding with us today, {name}! Remember to invite your friends for better quality games faster, and join us on Discord at discord.gg/taw`

## Recruiting pitch (`recruit-pitch`, DM after 15 min of real play, once a week per player)

- **message** `{name} {server} {players} {max} {kills}`:
  `Enjoying TAW WARDOGS NA, {name}? TAW is a real unit: squads, ranks, people who show up every night. See for yourself: discord.gg/taw`

## Regulars (`regulars`, DM on the visit that hits a tier)

- **visit 3** `{name} {visits} {minutes} {server}`:
  `Third visit, {name}. That makes you a regular around here. Come meet the rest of us: discord.gg/taw`
- **visit 10**:
  `{visits} visits and {minutes} minutes with TAW WARDOGS NA, {name}. Regulars like you get reserved slots. Ask in discord.gg/taw`

## Comeback (`comeback`, DM when someone returns after 14+ days)

- **message** `{name} {days}`:
  `Welcome back, {name}. {days} days is too long. Catch up with the crew: discord.gg/taw`

## Match MVP (`match-mvp`, off until approved)

- **broadcast** `{map} {list}`: `Match MVPs on {map}: {list}. GG all.`
- **mvpMessage** `{name} {kills} {deaths}`:
  `MVP, {name}. {kills}K/{deaths}D. TAW recruits players like you. Come see what we are about: discord.gg/taw`

## Kill streak (`kill-streak`, off until approved)

- **message** `{name} {kills}`: `{name} is on a {kills}-kill streak. Someone stop them.`
  In whisper mode use: `{kills} in a row, {name}. Keep it going.`

## Playtime ranks (`playtime-ranks`, off until approved; 5 / 25 / 100 h)

- **announce** `{name} {title} {hours} {server}`: `{name} just made {title}: {hours} hours with TAW WARDOGS NA. Respect.`

## Reserved slot reward (`reserved-slot-reward`, blocked by #5)

- **message** `{visits} {name} {server}`:
  `Thanks for coming back {visits} times, {name}. You now have a reserved slot on TAW WARDOGS NA. See you tonight.`

## Discord rally (`fill-server`, needs #2)

- **message** (Discord, markdown) `{players} {max} {server} {map} {free}`:
  `Only **{players}/{max}** on **{server}** ({map}). {free} slots free. Two people joining right now turns this into a game.`
- **broadcast** (in-game) `{free}`: `Quiet in here. Invite a friend, {free} slots free.`
- **connectInfo**: `Search "TAW" in the server browser`

## Prime time (`prime-time`, Discord, needs #2)

- **message** `{server} {players} {max} {map}`: `{server} is popping: {players}/{max} on {map}. Get in.`

## Team balance (`team-balance`, warn only)

- **warnMessage** `{a} {b}`: `Teams are uneven ({a} vs {b}). Switch over and keep it a fight.`

## Rules (draft)

For blocker #1. Written to fit one MOTD line and one Discord post. Edit freely; the numbering is for admins.

1. **Play fair.** No cheats, exploits, or glitch abuse. Permanent ban.
2. **No harassment.** No slurs, hate, or targeting people. Kick, then ban.
3. **No griefing.** No team-killing on purpose, no blocking spawns or vehicles, no mic or chat spam.
4. **Respect admins.** They are volunteers. Take it to Discord if you disagree.
5. **New players are welcome here.** Help them or leave them alone.

One-line version for the MOTD: `Rules here are simple: play fair, no cheating, no harassment, no griefing. Admins are in discord.gg/taw`

## What is deliberately not said

- No member counts, founding years, or "biggest" claims. They date, and they are not why anyone joins.
- No "join now" pressure on the first DM. The first visit is for the game; the pitch comes after 15 minutes of it.
- No second link. Everything routes through discord.gg/taw.

## Ban reasons and appeals

The ban reason is the one line a banned player sees. The panel appends the appeal path to every reason
(admin-panel option `appealNote`, default `Appeal at discord.gg/taw`), so an admin only writes the cause:

- `Cheating` → the player sees `Cheating. Appeal at discord.gg/taw`
- `Team-killing after two warnings` → `Team-killing after two warnings. Appeal at discord.gg/taw`
- a temp ban with no reason typed → `Appeal at discord.gg/taw`

Write the cause as a fact, not an insult: it is read by the player, quoted in the appeal, and kept in
`data/admin-actions.jsonl` under the admin's name. Rules line for the rotation once an appeals channel exists:
`Rules: play fair, no cheating, no harassment, no griefing. Report a player or appeal a ban at discord.gg/taw`
