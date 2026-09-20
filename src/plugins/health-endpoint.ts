import { acquireWebServer } from '../host/webserver.ts';
import { definePlugin } from '../host/plugin.ts';

interface Options {
  path: string;
  /** Report unhealthy when the last successful poll is older than this many poll intervals. */
  staleAfterPolls: number;
}

/**
 * Liveness probe for uptime monitors on the shared HTTP listener (needs HTTP_PORT).
 * 200 while polls are fresh and the game server is reachable, 503 otherwise.
 */
export default definePlugin<Options>({
  name: 'health-endpoint',
  description: 'HTTP health check for uptime monitors',
  defaults: { path: '/healthz', staleAfterPolls: 3 },
  setup(ctx) {
    if (!ctx.host.httpPort) {
      ctx.log.warn('HTTP_PORT is not set; plugin is idle');
      return;
    }
    const web = acquireWebServer(ctx.host.httpPort, ctx.log, ctx.host.httpBind ?? '0.0.0.0');
    const unregister = web.register({
      method: 'GET',
      path: ctx.options.path,
      handler: (_req, res) => {
        const last = ctx.lastPollAt();
        const age = last === null ? null : Date.now() - last;
        const fresh = age !== null && age < Number(ctx.options.staleAfterPolls) * ctx.host.pollMs;
        const serverUp = ctx.serverUp();
        const ok = fresh && serverUp;
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok,
            status: ok ? 'ok' : serverUp ? 'stale' : 'down',
            lastPollAgeMs: age,
            serverUp,
          }),
        );
      },
    });
    ctx.onStop(() => {
      unregister();
      web.release();
    });
    ctx.log.info(
      `health at http://${ctx.host.httpBind ?? '0.0.0.0'}:${ctx.host.httpPort}${ctx.options.path}`,
    );
  },
});
