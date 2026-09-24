/** Shared scaffolding for plugin tests: a host wired to the mock RCON server with a temp data dir. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginHost } from '../host/host.ts';
import { createLogger } from '../host/logger.ts';
import { RconClient } from '../rcon/client.ts';
import type { AnyPlugin } from '../host/plugin.ts';
import type { HostConfig } from '../config.ts';
import { TOKEN, type MockServer, type Recorded } from './mock-server.ts';

export interface HostHandle {
  host: PluginHost;
  dataDir: string;
}

export function makeHost(
  s: MockServer,
  plugins: AnyPlugin[],
  options: Record<string, Record<string, unknown>> = {},
  over: Partial<HostConfig> = {},
): HostHandle {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  // A real plugins file, so toggles and option edits made during a test can persist like in production.
  const pluginsFile = path.join(dataDir, 'plugins.json');
  fs.writeFileSync(
    pluginsFile,
    JSON.stringify(
      Object.fromEntries(plugins.map((p) => [p.name, { enabled: true, ...(options[p.name] ?? {}) }])),
      null,
      2,
    ),
  );
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: {
      pollMs: 20,
      auditPollMs: 30,
      dataDir,
      logLevel: 'error',
      pluginsFile,
      // Unthrottled by default so plugin tests see their messages at once; outbox tests set their own limits.
      outbox: { dmPerMinute: 1_000_000, broadcastPerMinute: 1_000_000, dmGapPerPlayerMs: 0 },
      ...over,
    },
    plugins: Object.fromEntries(plugins.map((p) => [p.name, { enabled: true, ...(options[p.name] ?? {}) }])),
    registry: Object.fromEntries(plugins.map((p) => [p.name, p])),
    logger: createLogger('error'),
  });
  return { host, dataDir };
}

/** Pre-populate a plugin's persisted state before the host starts. */
export function seedState(dataDir: string, plugin: string, state: Record<string, unknown>): void {
  fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'state', `${plugin}.json`), JSON.stringify(state));
}

/** Write stats-logger style lines into today's stats file. */
export function writeStats(dataDir: string, lines: unknown[]): void {
  const dir = path.join(dataDir, 'stats');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

export const requestsTo = (s: MockServer, method: string, path: string): Recorded[] =>
  s.requests.filter((r) => r.method === method && r.path === path);

export const bodyOf = <T = Record<string, unknown>>(r: Recorded | undefined): T =>
  JSON.parse(r?.body || '{}') as T;
