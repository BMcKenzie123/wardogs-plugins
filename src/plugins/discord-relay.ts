import { isNoiseAudit } from '../host/audit.ts';
import { definePlugin } from '../host/plugin.ts';
import { postJson } from '../host/http.ts';
import type { EventName, Snapshot } from '../host/events.ts';
import type { FactionScore } from '../rcon/types.ts';

interface Options {
  webhookUrl: string;
  events: string[];
  scoreEveryMinutes: number;
}

interface Embed {
  title: string;
  description: string;
  color: number;
}

const COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  blue: 0x3498db,
  grey: 0x95a5a6,
  orange: 0xe67e22,
} as const;

const RELAYABLE: EventName[] = [
  'server.up',
  'server.down',
  'match.map',
  'match.new',
  'match.lighting',
  'player.join',
  'player.leave',
  'audit.entry',
];

/** Pull a numeric score out of a faction row if the server includes one (field name is server-defined). */
export function scoreOf(row: FactionScore): number | null {
  for (const [key, value] of Object.entries(row)) {
    if (key === 'colorHex' || key === 'name') continue;
    if (typeof value === 'number') return value;
  }
  return null;
}

export function scoreboard(snapshot: Snapshot): string {
  const lines = snapshot.status.factionScores.map((row) => {
    const score = scoreOf(row);
    return score === null ? row.name : `${row.name}: ${score}`;
  });
  return lines.length ? lines.join(' · ') : 'no factions reported';
}

function playerCount(snapshot: Snapshot): string {
  return `${snapshot.status.players.current}/${snapshot.status.players.max}`;
}

function mmss(seconds: number | null): string {
  if (seconds === null) return 'unknown';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export default definePlugin<Options>({
  name: 'discord-relay',
  description: 'Posts server events and a periodic scoreboard to a Discord webhook',
  defaults: {
    webhookUrl: '',
    events: [
      'server.up',
      'server.down',
      'match.map',
      'match.new',
      'player.join',
      'player.leave',
      'audit.entry',
    ],
    scoreEveryMinutes: 5,
  },
  setup(ctx) {
    const url = ctx.options.webhookUrl || ctx.host.discordWebhookUrl || '';
    if (!url) {
      ctx.log.warn('no webhook URL configured (set webhookUrl or DISCORD_WEBHOOK_URL); plugin is idle');
      return;
    }

    // Serialized queue: one post per second, bounded so an outage can't build an unbounded backlog.
    const queue: Embed[] = [];
    let draining = false;
    const drain = (): void => {
      if (draining) return;
      const embed = queue.shift();
      if (!embed) return;
      draining = true;
      postJson(url, {
        username: 'WARDOGS',
        embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      })
        .catch((e: unknown) => ctx.log.warn('discord post failed', e))
        .finally(() => {
          setTimeout(() => {
            draining = false;
            drain();
          }, 1000);
        });
    };
    const post = (title: string, description: string, color: number): void => {
      if (queue.length >= 50) {
        ctx.log.warn('discord queue full; dropping post');
        return;
      }
      queue.push({ title, description: description.slice(0, 4000), color });
      drain();
    };

    const wanted = new Set(ctx.options.events.filter((e) => RELAYABLE.includes(e as EventName)));
    const unknown = ctx.options.events.filter((e) => !RELAYABLE.includes(e as EventName));
    if (unknown.length) ctx.log.warn(`ignoring unknown events: ${unknown.join(', ')}`);

    if (wanted.has('server.up'))
      ctx.on('server.up', ({ snapshot, downForMs }) => {
        const gap = downForMs === null ? '' : ` after ${mmss(downForMs / 1000)} down`;
        post(
          'Server up',
          `**${snapshot.status.serverName}** is reachable${gap}. Map **${snapshot.status.map}**, ${playerCount(snapshot)} players.`,
          COLORS.green,
        );
      });
    if (wanted.has('server.down'))
      ctx.on('server.down', ({ error }) => post('Server unreachable', error.message, COLORS.red));
    if (wanted.has('match.map'))
      ctx.on('match.map', ({ from, to, snapshot }) => {
        const exp = to.experiences.length ? ` (${to.experiences.join(' + ')})` : '';
        post(
          'Map changed',
          `**${from.map}** → **${to.map}**${exp}. ${playerCount(snapshot)} players.`,
          COLORS.blue,
        );
      });
    if (wanted.has('match.new'))
      ctx.on('match.new', ({ snapshot }) =>
        post(
          'New match',
          `**${snapshot.status.map}** restarted. ${playerCount(snapshot)} players.`,
          COLORS.blue,
        ),
      );
    if (wanted.has('match.lighting'))
      ctx.on('match.lighting', ({ from, to }) => post('Lighting changed', `${from} → ${to}`, COLORS.blue));
    if (wanted.has('player.join'))
      ctx.on('player.join', ({ player, snapshot }) =>
        post(
          'Player joined',
          `**${player.name}** (${player.steamId}). Now ${playerCount(snapshot)}.`,
          COLORS.grey,
        ),
      );
    if (wanted.has('player.leave'))
      ctx.on('player.leave', ({ player, snapshot, sessionSeconds }) =>
        post(
          'Player left',
          `**${player.name}** (${player.steamId}) after ${mmss(sessionSeconds)} — ${player.kills}K/${player.deaths}D. Now ${playerCount(snapshot)}.`,
          COLORS.grey,
        ),
      );
    if (wanted.has('audit.entry'))
      ctx.on('audit.entry', ({ entry }) => {
        if (isNoiseAudit(entry)) return; // never relay this host's own polling to Discord
        return post(
          `Audit: ${entry.event}`,
          `${entry.detail}\nby ${entry.peer} · ${entry.timestampUtc}`,
          COLORS.orange,
        );
      });

    const minutes = Number(ctx.options.scoreEveryMinutes);
    if (minutes > 0)
      ctx.every(minutes * 60_000, () => {
        const snapshot = ctx.snapshot();
        if (!snapshot || snapshot.status.players.current < 1) return;
        post(
          `Scoreboard — ${snapshot.status.map}`,
          `${scoreboard(snapshot)}\n${playerCount(snapshot)} players · ${mmss(snapshot.status.matchSeconds)} in`,
          COLORS.blue,
        );
      });

    ctx.log.info(
      `relaying ${[...wanted].join(', ')}${minutes > 0 ? ` + scoreboard every ${minutes} min` : ''}`,
    );
  },
});
