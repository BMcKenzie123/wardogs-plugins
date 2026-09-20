/**
 * In-process fakes for tests: the WARDOGS RCON /v1 API, a Discord webhook sink, the two Steam
 * Web API calls the plugins use, and a Discord channel-messages endpoint.
 * Mutate `state` between polls to simulate the live server changing.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AuditEntry, Ban, FactionScore, Player, RotationEntry } from '../rcon/types.ts';

export interface MockState {
  serverName: string;
  map: string;
  experiences: string[];
  lighting: string;
  alternator: string;
  matchSeconds: number;
  maxPlayers: number;
  scoreTick: { current: number; min: number; max: number };
  factionScores: FactionScore[];
  players: Player[];
  routes: string[];
  audit: AuditEntry[];
  bans: Ban[];
  reservedSlots: string[];
  configRevision: string;
  configText: string;
  lightings: string[];
  maps: string[];
  sponsorUrl: string;
  rotation: { enabled: boolean; mode: string; entries: RotationEntry[] };
  rotationSaved: number;
  matchEnded: number;
  matchRestarted: number;
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
    scoreTick: { current: 24, min: 18, max: 30 },
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
    configText: '[Mock]\nkey=1\n',
    lightings: ['DayClear', 'DayLateGray', 'Night'],
    maps: ['Kavkazi', 'Europe'],
    sponsorUrl: '',
    rotation: { enabled: true, mode: 'ordered', entries: [] },
    rotationSaved: 0,
    matchEnded: 0,
    matchRestarted: 0,
  };
}

function listen(server: http.Server, port = 0): Promise<number> {
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((e) => (e ? reject(e) : resolve()));
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

export async function startMockServer(
  opts: { port?: number; state?: Partial<MockState> } = {},
): Promise<MockServer> {
  const state: MockState = { ...defaultState(), ...opts.state };
  const requests: Recorded[] = [];

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
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
    const json = <T>(): T => JSON.parse(body || '{}') as T;

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
        scoreTick: state.scoreTick,
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
      send(200, { entries: state.audit.slice(0, Number(url.searchParams.get('limit') ?? 50)) });
    } else if (method === 'GET' && path === '/v1/bans') {
      send(200, { bans: state.bans });
    } else if (method === 'POST' && path === '/v1/bans') {
      const b = json<{ steamId: string; reason?: string }>();
      state.bans.push({
        steamId: b.steamId,
        bannedAtUtc: new Date().toISOString(),
        bannedBy: 'mock',
        reason: b.reason ?? '',
      });
      send(200, { ok: true });
    } else if (method === 'DELETE' && (match = m(/^\/v1\/bans\/([^/]+)$/))) {
      const id = decodeURIComponent(match![1]!);
      state.bans = state.bans.filter((b) => b.steamId !== id);
      send(200, { ok: true });
    } else if (method === 'GET' && path === '/v1/reserved-slots') {
      send(200, { reservedSlots: state.reservedSlots });
    } else if (method === 'POST' && path === '/v1/reserved-slots') {
      state.reservedSlots.push(json<{ steamId: string }>().steamId);
      send(200, { ok: true });
    } else if (method === 'DELETE' && (match = m(/^\/v1\/reserved-slots\/([^/]+)$/))) {
      const id = decodeURIComponent(match![1]!);
      state.reservedSlots = state.reservedSlots.filter((s) => s !== id);
      send(200, { ok: true });
    } else if (method === 'GET' && path === '/v1/config') {
      send(200, {
        revision: state.configRevision,
        writable: true,
        text: state.configText,
        sections: [],
        warnings: [],
      });
    } else if (method === 'PUT' && path === '/v1/config') {
      if (
        url.searchParams.get('force') === 'true' ||
        req.headers['if-match'] === `"${state.configRevision}"`
      ) {
        state.configRevision = `r${Number(state.configRevision.slice(1)) + 1}`;
        state.configText = body;
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
    } else if (method === 'PATCH' && path === '/v1/settings') {
      const p = json<{ scoreTick?: number; rotationEnabled?: boolean; rotationMode?: string }>();
      if (typeof p.scoreTick === 'number') state.scoreTick.current = p.scoreTick;
      if (typeof p.rotationEnabled === 'boolean') state.rotation.enabled = p.rotationEnabled;
      if (typeof p.rotationMode === 'string') state.rotation.mode = p.rotationMode;
      send(200, { ok: true });
    } else if (method === 'GET' && path === '/v1/catalog/lightings') {
      send(200, { lightings: state.lightings });
    } else if (method === 'GET' && path === '/v1/catalog/maps') {
      send(200, { maps: state.maps });
    } else if (method === 'GET' && path === '/v1/sponsor') {
      send(200, { imageUrl: state.sponsorUrl });
    } else if (method === 'PUT' && path === '/v1/sponsor') {
      state.sponsorUrl = json<{ imageUrl: string }>().imageUrl;
      send(200, { ok: true });
    } else if (method === 'GET' && path === '/v1/rotation') {
      send(200, state.rotation);
    } else if (method === 'POST' && path === '/v1/rotation/entries') {
      const sel = json<{ map: string; experiences?: string[]; lighting?: string; zoneAlternator?: string }>();
      state.rotation.entries.push({
        map: sel.map,
        experiences: sel.experiences ?? [],
        lighting: sel.lighting ?? '',
        zoneAlternator: sel.zoneAlternator ?? '',
        status: '',
        denied: false,
      });
      send(200, { ok: true });
    } else if (method === 'DELETE' && (match = m(/^\/v1\/rotation\/entries\/(\d+)$/))) {
      state.rotation.entries.splice(Number(match![1]), 1);
      send(200, { ok: true });
    } else if (method === 'POST' && (match = m(/^\/v1\/rotation\/entries\/(\d+)\/move$/))) {
      const i = Number(match![1]);
      const j = json<{ direction: 'up' | 'down' }>().direction === 'up' ? i - 1 : i + 1;
      const entries = state.rotation.entries;
      if (entries[i] && entries[j]) [entries[i], entries[j]] = [entries[j]!, entries[i]!];
      send(200, { ok: true });
    } else if (method === 'POST' && path === '/v1/rotation/save') {
      state.rotationSaved += 1;
      send(200, { ok: true });
    } else if (method === 'POST' && path === '/v1/broadcast') {
      send(200, { ok: true });
    } else if (method === 'PUT' && path === '/v1/world/lighting') {
      state.lighting = json<{ lighting: string }>().lighting;
      send(200, { ok: true });
    } else if (method === 'POST' && path === '/v1/match/map') {
      const sel = json<{ map: string; experiences?: string[]; lighting?: string }>();
      state.map = sel.map;
      if (sel.experiences) state.experiences = sel.experiences;
      if (sel.lighting) state.lighting = sel.lighting;
      state.matchSeconds = 0;
      send(200, { ok: true });
    } else if (method === 'POST' && path === '/v1/match/end') {
      state.matchEnded += 1;
      state.matchSeconds = 0;
      send(200, { ok: true });
    } else if (method === 'POST' && path === '/v1/match/restart') {
      state.matchRestarted += 1;
      state.matchSeconds = 0;
      send(200, { ok: true });
    } else if (method === 'POST' && (match = m(/^\/v1\/players\/([^/]+)\/(kick|kill|message)$/))) {
      const id = decodeURIComponent(match![1]!);
      if (match![2] === 'kick') state.players = state.players.filter((p) => p.steamId !== id);
      send(200, { ok: true });
    } else if (method === 'PATCH' && (match = m(/^\/v1\/players\/([^/]+)$/))) {
      const id = decodeURIComponent(match![1]!);
      const p = state.players.find((x) => x.steamId === id);
      if (p) p.faction = json<{ faction: string }>().faction;
      send(200, { ok: true });
    } else {
      fail(404, 'NOT_FOUND', `no route ${method} ${path}`);
    }
  });

  const port = await listen(server, opts.port ?? 0);
  return { url: `http://127.0.0.1:${port}`, port, state, requests, close: () => closeServer(server) };
}

// ---------- Discord webhook sink ----------

export interface WebhookSink {
  url: string;
  posts: unknown[];
  close(): Promise<void>;
}

/** Accepts webhook POSTs and records the JSON bodies. */
export async function startWebhookSink(): Promise<WebhookSink> {
  const posts: unknown[] = [];
  const server = http.createServer(async (req, res) => {
    posts.push(JSON.parse((await readBody(req)) || 'null'));
    res.writeHead(204).end();
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/hook`, posts, close: () => closeServer(server) };
}

// ---------- Steam Web API ----------

export interface SteamMockState {
  /** Raw GetPlayerSummaries player objects keyed by steamId (without the steamid field). */
  summaries: Record<string, Record<string, unknown>>;
  /** Raw GetPlayerBans player objects keyed by steamId (without the SteamId field). */
  bans: Record<string, Record<string, unknown>>;
}

export interface SteamMock {
  baseUrl: string;
  state: SteamMockState;
  requests: string[];
  close(): Promise<void>;
}

export async function startSteamMock(state: Partial<SteamMockState> = {}): Promise<SteamMock> {
  const full: SteamMockState = { summaries: {}, bans: {}, ...state };
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://steam');
    requests.push(req.url ?? '/');
    const ids = (url.searchParams.get('steamids') ?? '').split(',').filter(Boolean);
    const send = (payload: unknown): void => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/ISteamUser/GetPlayerSummaries/v2/') {
      send({
        response: {
          players: ids
            .filter((id) => full.summaries[id])
            .map((id) => ({ steamid: id, ...full.summaries[id] })),
        },
      });
    } else if (url.pathname === '/ISteamUser/GetPlayerBans/v1/') {
      send({ players: ids.filter((id) => full.bans[id]).map((id) => ({ SteamId: id, ...full.bans[id] })) });
    } else {
      res.writeHead(404).end();
    }
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}`, state: full, requests, close: () => closeServer(server) };
}

// ---------- Discord channel messages ----------

export interface DiscordMessage {
  id: string;
  content: string;
  author: { username: string; bot?: boolean };
}

export interface DiscordMock {
  baseUrl: string;
  messages: DiscordMessage[];
  requests: Recorded[];
  close(): Promise<void>;
}

/** Serves GET /channels/{id}/messages?limit=&after= newest-first like the real API. */
export async function startDiscordMock(messages: DiscordMessage[] = []): Promise<DiscordMock> {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://discord');
    requests.push({ method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body: '' });
    if (!/^(\/api\/v10)?\/channels\/[^/]+\/messages$/.test(url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    const after = url.searchParams.get('after');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const list = messages
      .filter((msg) => !after || BigInt(msg.id) > BigInt(after))
      .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
      .slice(0, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
  });
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v10`,
    messages,
    requests,
    close: () => closeServer(server),
  };
}

// ---------- misc helpers ----------

/** An unused TCP port on localhost. */
export async function freePort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

/** GET a URL and return status + body text (no auth). */
export function fetchText(
  url: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      })
      .on('error', reject);
  });
}

/** Any-method HTTP request with headers and body; never follows redirects. */
export function httpRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method ?? 'GET', headers: opts.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
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
