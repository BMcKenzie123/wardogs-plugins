import { acquireWebServer } from '../host/webserver.ts';
import { definePlugin } from '../host/plugin.ts';
import { scoreOf } from './discord-relay.ts';

interface Options {
  path: string;
}

const label = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/** Prometheus text-format metrics on the shared HTTP listener (needs HTTP_PORT). */
export default definePlugin<Options>({
  name: 'prometheus-metrics',
  description: 'Exposes server metrics for Prometheus / Grafana',
  defaults: { path: '/metrics' },
  setup(ctx) {
    if (!ctx.host.httpPort) {
      ctx.log.warn('HTTP_PORT is not set; plugin is idle');
      return;
    }
    const web = acquireWebServer(ctx.host.httpPort, ctx.log);
    const unregister = web.register({
      method: 'GET',
      path: ctx.options.path,
      handler: (_req, res) => {
        const lines: string[] = [];
        const gauge = (name: string, help: string, value: number, labels = ''): void => {
          lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}${labels} ${value}`);
        };
        gauge('wardogs_up', 'RCON API reachable (1) or not (0)', ctx.serverUp() ? 1 : 0);
        const last = ctx.lastPollAt();
        gauge(
          'wardogs_last_poll_age_seconds',
          'Seconds since the last successful poll',
          last ? (Date.now() - last) / 1000 : -1,
        );

        const snapshot = ctx.snapshot();
        if (snapshot) {
          const { status, players } = snapshot;
          gauge('wardogs_players', 'Connected players', status.players.current);
          gauge('wardogs_players_max', 'Player slots', status.players.max);
          gauge('wardogs_match_seconds', 'Seconds into the current match', status.matchSeconds);
          gauge('wardogs_score_tick', 'Current score tick period', status.scoreTick.current);
          const pings = players.map((player) => player.pingMs);
          gauge(
            'wardogs_ping_ms_avg',
            'Average player ping',
            pings.length ? pings.reduce((a, b) => a + b, 0) / pings.length : 0,
          );
          gauge('wardogs_ping_ms_max', 'Highest player ping', pings.length ? Math.max(...pings) : 0);
          for (const faction of status.factionScores) {
            const l = `{faction="${label(faction.name)}"}`;
            lines.push(`wardogs_faction_score${l} ${scoreOf(faction) ?? 0}`);
            lines.push(
              `wardogs_faction_players${l} ${players.filter((player) => player.faction === faction.name).length}`,
            );
          }
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(`${lines.join('\n')}\n`);
      },
    });
    ctx.onStop(() => {
      unregister();
      web.release();
    });
    ctx.log.info(`metrics at http://0.0.0.0:${ctx.host.httpPort}${ctx.options.path}`);
  },
});
