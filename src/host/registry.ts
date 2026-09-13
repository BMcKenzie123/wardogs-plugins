import type { AnyPlugin } from './plugin.ts';
import welcome from '../plugins/welcome.ts';
import motd from '../plugins/motd.ts';
import discordRelay from '../plugins/discord-relay.ts';
import pingGuard from '../plugins/ping-guard.ts';
import teamBalance from '../plugins/team-balance.ts';
import statsLogger from '../plugins/stats-logger.ts';
import auditTail from '../plugins/audit-tail.ts';
import emptyServer from '../plugins/empty-server.ts';
import banSync from '../plugins/ban-sync.ts';
import lightingClock from '../plugins/lighting-clock.ts';
import recruitPitch from '../plugins/recruit-pitch.ts';
import regulars from '../plugins/regulars.ts';
import matchMvp from '../plugins/match-mvp.ts';
import fillServer from '../plugins/fill-server.ts';
import eventAnnouncer from '../plugins/event-announcer.ts';
export const registry: Record<string, AnyPlugin> = Object.fromEntries(
  [
    welcome,
    motd,
    discordRelay,
    pingGuard,
    teamBalance,
    statsLogger,
    auditTail,
    emptyServer,
    banSync,
    lightingClock,
    recruitPitch,
    regulars,
    matchMvp,
    fillServer,
    eventAnnouncer,
  ].map((p) => [p.name, p]),
);
