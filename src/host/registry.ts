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
import seedThanks from '../plugins/seed-thanks.ts';
import reservedSlotReward from '../plugins/reserved-slot-reward.ts';
import comeback from '../plugins/comeback.ts';
import killStreak from '../plugins/kill-streak.ts';
import firstTimer from '../plugins/first-timer.ts';
import playtimeRanks from '../plugins/playtime-ranks.ts';
import discordAnnounceBridge from '../plugins/discord-announce-bridge.ts';
import primeTime from '../plugins/prime-time.ts';
import nameFilter from '../plugins/name-filter.ts';
import afkKick from '../plugins/afk-kick.ts';
import tempBans from '../plugins/temp-bans.ts';
import vacCheck from '../plugins/vac-check.ts';
import newAccountGate from '../plugins/new-account-gate.ts';
import adminAlerts from '../plugins/admin-alerts.ts';
import rotationScheduler from '../plugins/rotation-scheduler.ts';
import populationMaps from '../plugins/population-maps.ts';
import staleMatch from '../plugins/stale-match.ts';
import weatherRandomizer from '../plugins/weather-randomizer.ts';
import scoreTickTuner from '../plugins/score-tick-tuner.ts';
import sponsorRotator from '../plugins/sponsor-rotator.ts';
import configBackup from '../plugins/config-backup.ts';
import weeklyRecap from '../plugins/weekly-recap.ts';
import leaderboard from '../plugins/leaderboard.ts';
import steamProfiles from '../plugins/steam-profiles.ts';
import prometheusMetrics from '../plugins/prometheus-metrics.ts';
import webDashboard from '../plugins/web-dashboard.ts';
import healthEndpoint from '../plugins/health-endpoint.ts';
import downtimeAlert from '../plugins/downtime-alert.ts';
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
    seedThanks,
    reservedSlotReward,
    comeback,
    killStreak,
    firstTimer,
    playtimeRanks,
    discordAnnounceBridge,
    primeTime,
    nameFilter,
    afkKick,
    tempBans,
    vacCheck,
    newAccountGate,
    adminAlerts,
    rotationScheduler,
    populationMaps,
    staleMatch,
    weatherRandomizer,
    scoreTickTuner,
    sponsorRotator,
    configBackup,
    weeklyRecap,
    leaderboard,
    steamProfiles,
    prometheusMetrics,
    webDashboard,
    healthEndpoint,
    downtimeAlert,
  ].map((p) => [p.name, p]),
);
