/**
 * In-process fake of the WARDOGS RCON /v1 API for tests.
 * Mutate `state` between polls to simulate the live server changing.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AuditEntry, Ban, FactionScore, Player } from '../rcon/types.ts';

export interface MockState {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string;
  alternator: string;
  matchSeconds: number;
  maxPlayers: number;
  factionScores: FactionScore[];
  players: Player[];
  routes: string[];
  audit: AuditEntry[];
  bans: Ban[];
  reservedSlots: string[];
  configRevision: string;
  lightings: string[];
}

export interface Recorded {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface MockServer {
  url: string;
  port: number;
  state: MockState;
  requests: Recorded[];
  close(): Promise<void>;
}

export const TOKEN = 'test-token';

export function player(steamId: string, extra: Partial<Player> = {}): Player {
  return { name: `P${steamId}`, steamId, faction: 'Red', kills: 0, deaths: 0, cash: 0, pingMs: 40, ...extra };
}

export function defaultState(): MockState {
  return {
    serverName: 'Mock Server',
    map: 'Kavkazi',
    experiences: ['Bakurani_KOTH_01'],
    lighting: 'DayClear',
    alternator: '',
    matchSeconds: 100,
    maxPlayers: 64,
    factionScores: [
      { name: 'Red', colorHex: '#f00', score: 0 },
      { name: 'Blue', colorHex: '#00f', score: 0 },
    ],
    players: [],
    routes: [
      'GET /v1/status',
      'GET /v1/players',
      'GET /v1/capabilities',
      'GET /v1/audit',
      'POST /v1/broadcast',
      'POST /v1/players/{id}/kick',
      'POST /v1/players/{id}/message',
      'PATCH /v1/players/{id}',
      'PUT /v1/world/lighting',
    ],
    audit: [],
    bans: [],
    reservedSlots: [],
    configRevision: 'r1',
    lightings: ['DayClear', 'DayLateGray', 'Night'],
  };
}

export async function startMockServer(
  opts: { port?: number; state?: Partial<MockState> } = {},
): Promise<MockServer> {
  const state: MockState = { ...defaultState(), ...opts.state };
  const requests: Recorded[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://mock');
      const path = url.pathname;
      // Record the raw URL (with query string and %-encoding) so tests can assert on exactly what was sent.
      requests.push({ method, path: req.url ?? '/', headers: req.headers, body });

      const send = (code: number, payload: unknown): void => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const fail = (code: number, errCode: string, message: string): void =>
        send(code, { error: { code: errCode, message } });

      if (path === '/slow') {
        setTimeout(() => send(200, { ok: true }), 300);
        return;
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        fail(401, 'UNAUTHORIZED', 'bad token');
        return;
      }

      const m = (re: RegExp): RegExpMatchArray | null => path.match(re);
      let match: RegExpMatchArray | null;

      if (method === 'GET' && path === '/v1/status') {
        send(200, {
          serverName: state.serverName,
          map: state.map,
          experiences: state.experiences,
          lighting: state.lighting,
          alternator: state.alternator,
          scoreTick: { current: 24, min: 18, max: 30 },
          scoreCap: 1000,
          matchSeconds: state.matchSeconds,
          players: { current: state.players.length, max: state.maxPlayers },
          factionScores: state.factionScores,
          rotation: null,
        });
      } else if (method === 'GET' && path === '/v1/players') {
        send(200, { players: state.players });
      } else if (method === 'GET' && path === '/v1/capabilities') {
        send(200, { routes: state.routes, config: { writable: true } });
      } else if (method === 'GET' && path === '/v1/audit') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        send(200, { entries: state.audit.slice(0, limit) });
      } else if (method === 'GET' && path === '/v1/bans') {
        send(200, { bans: state.bans });
      } else if (method === 'POST' && path === '/v1/bans') {
        const b = JSON.parse(body || '{}') as { steamId: string; reason?: string };
        state.bans.push({
          steamId: b.steamId,
          bannedAtUtc: new Date().toISOString(),
          bannedBy: 'mock',
          reason: b.reason ?? '',
        });
        send(200, { ok: true });
      } else if (method === 'DELETE' && (match = m(/^\/v1\/bans\/([^/]+)$/))) {
        state.bans = state.bans.filter((b) => b.steamId !== decodeURIComponent(match![1]!));
        send(200, { ok: true });
      } else if (method === 'GET' && path === '/v1/reserved-slots') {
        send(200, { reservedSlots: state.reservedSlots });
      } else if (method === 'GET' && path === '/v1/config') {
        send(200, {
          revision: state.configRevision,
          writable: true,
          text: '[Mock]\nkey=1\n',
          sections: [],
          warnings: [],
        });
      } else if (method === 'PUT' && path === '/v1/config') {
        if (
          url.searchParams.get('force') === 'true' ||
          req.headers['if-match'] === `"${state.configRevision}"`
        ) {
          state.configRevision = `r${Number(state.configRevision.slice(1)) + 1}`;
          send(200, { ok: true, revision: state.configRevision, changed: [], warnings: [] });
        } else {
          send(412, {
            ok: false,
            revision: state.configRevision,
            conflict: ['revision'],
            error: { code: 'REVISION_MISMATCH', message: 'stale revision' },
          });
        }
      } else if (method === 'POST' && path === '/v1/config/validate') {
        send(200, { ok: true, revision: state.configRevision });
      } else if (method === 'GET' && path === '/v1/catalog/lightings') {
        send(200, { lightings: state.lightings });
      } else if (method === 'POST' && path === '/v1/broadcast') {
        send(200, { ok: true });
      } else if (method === 'PUT' && path === '/v1/world/lighting') {
        state.lighting = (JSON.parse(body || '{}') as { lighting: string }).lighting;
        send(200, { ok: true });
      } else if (method === 'POST' && path === '/v1/match/map') {
        const sel = JSON.parse(body || '{}') as { map: string; experiences?: string[]; lighting?: string };
        state.map = sel.map;
        if (sel.experiences) state.experiences = sel.experiences;
        if (sel.lighting) state.lighting = sel.lighting;
        state.matchSeconds = 0;
        send(200, { ok: true });
      } else if (method === 'POST' && (match = m(/^\/v1\/players\/([^/]+)\/(kick|kill|message)$/))) {
        const id = decodeURIComponent(match![1]!);
        if (match![2] === 'kick') state.players = state.players.filter((p) => p.steamId !== id);
        send(200, { ok: true });
      } else if (method === 'PATCH' && (match = m(/^\/v1\/players\/([^/]+)$/))) {
        const id = decodeURIComponent(match![1]!);
        const p = state.players.find((x) => x.steamId === id);
        if (p) p.faction = (JSON.parse(body || '{}') as { faction: string }).faction;
        send(200, { ok: true });
      } else {
        fail(404, 'NOT_FOUND', `no route ${method} ${path}`);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    state,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

/** Poll `pred` until it returns true or `timeoutMs` elapses. */
export async function waitFor(pred: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
