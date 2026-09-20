import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { Logger } from '../host/logger.ts';
import type { RconConfig } from '../config.ts';
import type {
  Audit,
  Bans,
  Capabilities,
  Catalog,
  ConfigDocument,
  ConfigResult,
  MapSelection,
  Ok,
  Players,
  ReservedSlots,
  Rotation,
  SettingsPatch,
  Sponsor,
  Status,
} from './types.ts';

export class RconError extends Error {
  status: number;
  code: string | undefined;
  body: unknown;
  method: string;
  path: string;
  constructor(
    message: string,
    status: number,
    code: string | undefined,
    body: unknown,
    method: string,
    path: string,
  ) {
    super(message);
    this.name = 'RconError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.method = method;
    this.path = path;
  }
}
export class RconConflictError extends RconError {
  result: ConfigResult;
  constructor(result: ConfigResult, method: string, path: string) {
    super(result.error?.message ?? 'Config revision conflict', 412, result.error?.code, result, method, path);
    this.name = 'RconConflictError';
    this.result = result;
  }
}
export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}
export class RconClient {
  readonly baseUrl: string;
  private cfg: RconConfig;
  private logger?: Logger;
  private agent: http.Agent | https.Agent;
  constructor(cfg: RconConfig, opts: { logger?: Logger } = {}) {
    this.cfg = cfg;
    this.logger = opts.logger;
    this.baseUrl = `${cfg.scheme}://${cfg.host}:${cfg.port}`;
    // One keep-alive socket for everything: requests queue behind each other instead of opening
    // parallel connections, so the game server sees a single source port (and one ACCEPT in its audit
    // log) rather than a new one per call.
    const pool = { keepAlive: true, keepAliveMsecs: 10_000, maxSockets: 1, maxFreeSockets: 1 };
    this.agent =
      cfg.scheme === 'https'
        ? new https.Agent({
            ...pool,
            rejectUnauthorized: !cfg.tlsInsecure,
            ca: cfg.caFile ? fs.readFileSync(cfg.caFile) : undefined,
          })
        : new http.Agent(pool);
  }
  /** Drop pooled keep-alive sockets. Call from one-shot processes (the CLI) once you're done. */
  close(): void {
    this.agent.destroy();
  }
  request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) query.set(k, String(v));
    const requestPath = `${path}${query.size ? `?${query}` : ''}`;
    const body = options.text ?? (options.json === undefined ? undefined : JSON.stringify(options.json));
    const headers: Record<string, string | number> = {
      Authorization: `Bearer ${this.cfg.password}`,
      Accept: 'application/json',
      'User-Agent': 'wardogs-plugins/0.1',
      ...options.headers,
    };
    if (body !== undefined) {
      headers['Content-Type'] = options.text !== undefined ? 'text/plain' : 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    this.logger?.debug(`→ ${method.toUpperCase()} ${path}`);
    const started = Date.now();
    return new Promise<T>((resolve, reject) => {
      const lib = this.cfg.scheme === 'https' ? https : http;
      const req = lib.request(
        {
          protocol: `${this.cfg.scheme}:`,
          hostname: this.cfg.host,
          port: this.cfg.port,
          method,
          path: requestPath,
          headers,
          agent: this.agent,
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            raw += chunk;
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            this.logger?.debug(`← ${status} ${Date.now() - started}ms`);
            let parsed: unknown = raw;
            try {
              if ((res.headers['content-type'] ?? '').includes('application/json') || /^[\s]*[\[{]/.test(raw))
                parsed = raw ? JSON.parse(raw) : {};
            } catch {
              parsed = raw;
            }
            if (status >= 200 && status < 300) resolve(parsed as T);
            else if (status === 412 && method.toUpperCase() === 'PUT' && path === '/v1/config')
              reject(new RconConflictError(parsed as ConfigResult, method, path));
            else {
              const e =
                parsed && typeof parsed === 'object'
                  ? (parsed as { error?: { code?: string; message?: string } }).error
                  : undefined;
              reject(new RconError(e?.message ?? `HTTP ${status}`, status, e?.code, parsed, method, path));
            }
          });
        },
      );
      req.setTimeout(options.timeoutMs ?? this.cfg.timeoutMs, () => {
        req.destroy();
        reject(new RconError('Request timed out', 0, 'TIMEOUT', undefined, method, path));
      });
      req.on('error', (err: NodeJS.ErrnoException) =>
        reject(new RconError(err.message, 0, err.code ?? 'NETWORK', undefined, method, path)),
      );
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
  status(): Promise<Status> {
    return this.request('GET', '/v1/status');
  }
  players(): Promise<Players> {
    return this.request('GET', '/v1/players');
  }
  capabilities(): Promise<Capabilities> {
    return this.request('GET', '/v1/capabilities');
  }
  bans(): Promise<Bans> {
    return this.request('GET', '/v1/bans');
  }
  reservedSlots(): Promise<ReservedSlots> {
    return this.request('GET', '/v1/reserved-slots');
  }
  audit(limit = 50): Promise<Audit> {
    return this.request('GET', '/v1/audit', { query: { limit } });
  }
  config(): Promise<ConfigDocument> {
    return this.request('GET', '/v1/config');
  }
  rotation(): Promise<Rotation> {
    return this.request('GET', '/v1/rotation');
  }
  catalogMaps(): Promise<Catalog> {
    return this.request('GET', '/v1/catalog/maps');
  }
  catalogLightings(): Promise<Catalog> {
    return this.request('GET', '/v1/catalog/lightings');
  }
  catalogExperiences(): Promise<Catalog> {
    return this.request('GET', '/v1/catalog/experiences');
  }
  mapExperiences(id: string): Promise<Catalog> {
    return this.request('GET', `/v1/catalog/maps/${encodeURIComponent(id)}/experiences`);
  }
  mapAlternators(id: string): Promise<Catalog> {
    return this.request('GET', `/v1/catalog/maps/${encodeURIComponent(id)}/alternators`);
  }
  sponsor(): Promise<Sponsor> {
    return this.request('GET', '/v1/sponsor');
  }
  kick(id: string, reason?: string): Promise<Ok> {
    return this.request('POST', `/v1/players/${encodeURIComponent(id)}/kick`, {
      json: reason ? { reason } : {},
    });
  }
  kill(id: string): Promise<Ok> {
    return this.request('POST', `/v1/players/${encodeURIComponent(id)}/kill`);
  }
  message(id: string, message: string): Promise<Ok> {
    return this.request('POST', `/v1/players/${encodeURIComponent(id)}/message`, { json: { message } });
  }
  setFaction(id: string, faction: string): Promise<Ok> {
    return this.request('PATCH', `/v1/players/${encodeURIComponent(id)}`, { json: { faction } });
  }
  broadcast(message: string): Promise<Ok> {
    return this.request('POST', '/v1/broadcast', { json: { message } });
  }
  ban(steamId: string, reason?: string): Promise<Ok> {
    return this.request('POST', '/v1/bans', { json: { steamId, ...(reason ? { reason } : {}) } });
  }
  unban(id: string): Promise<Ok> {
    return this.request('DELETE', `/v1/bans/${encodeURIComponent(id)}`);
  }
  addReservedSlot(steamId: string): Promise<Ok> {
    return this.request('POST', '/v1/reserved-slots', { json: { steamId } });
  }
  removeReservedSlot(id: string): Promise<Ok> {
    return this.request('DELETE', `/v1/reserved-slots/${encodeURIComponent(id)}`);
  }
  changeMap(sel: MapSelection): Promise<Ok> {
    return this.request('POST', '/v1/match/map', { json: sel });
  }
  endMatch(): Promise<Ok> {
    return this.request('POST', '/v1/match/end');
  }
  restartMatch(): Promise<Ok> {
    return this.request('POST', '/v1/match/restart');
  }
  setLighting(lighting: string): Promise<Ok> {
    return this.request('PUT', '/v1/world/lighting', { json: { lighting } });
  }
  addRotationEntry(sel: MapSelection): Promise<Ok> {
    return this.request('POST', '/v1/rotation/entries', { json: sel });
  }
  removeRotationEntry(i: number): Promise<Ok> {
    return this.request('DELETE', `/v1/rotation/entries/${i}`);
  }
  moveRotationEntry(i: number, direction: 'up' | 'down'): Promise<Ok> {
    return this.request('POST', `/v1/rotation/entries/${i}/move`, { json: { direction } });
  }
  saveRotation(): Promise<Ok> {
    return this.request('POST', '/v1/rotation/save');
  }
  patchSettings(p: SettingsPatch): Promise<Ok> {
    return this.request('PATCH', '/v1/settings', { json: p });
  }
  validateConfig(text: string): Promise<ConfigResult> {
    return this.request('POST', '/v1/config/validate', { text });
  }
  putConfig(
    text: string,
    options: { ifMatch?: string; force?: boolean; fullApply?: boolean } = {},
  ): Promise<ConfigResult> {
    return this.request('PUT', '/v1/config', {
      text,
      headers: options.ifMatch ? { 'If-Match': `"${options.ifMatch}"` } : {},
      query: { force: options.force || undefined, fullApply: options.fullApply || undefined },
    });
  }
  setSponsor(imageUrl: string): Promise<Ok> {
    return this.request('PUT', '/v1/sponsor', { json: { imageUrl } });
  }
  static hasRoute(caps: Capabilities, method: string, pathTemplate: string): boolean {
    const normal = (p: string): string => p.replace(/\{[^}]+\}/g, '{id}');
    return caps.routes.some((route) => {
      const [m, p] = route.split(/\s+/, 2);
      return m?.toUpperCase() === method.toUpperCase() && normal(p ?? '') === normal(pathTemplate);
    });
  }
  hasRoute(caps: Capabilities, method: string, pathTemplate: string): boolean {
    return RconClient.hasRoute(caps, method, pathTemplate);
  }
}
