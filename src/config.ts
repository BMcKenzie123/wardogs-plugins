import fs from 'node:fs';

export interface RconConfig {
  host: string;
  port: number;
  scheme: 'http' | 'https';
  password: string;
  tlsInsecure: boolean;
  caFile?: string;
  timeoutMs: number;
}
export interface HostConfig {
  pollMs: number;
  auditPollMs: number;
  dataDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  pluginsFile: string;
  discordWebhookUrl?: string;
  discordBotToken?: string;
  /** The community's Discord invite (e.g. discord.gg/xxxx); fills `{discord}` in every message template. */
  discordInvite?: string;
  steamApiKey?: string;
  httpPort?: number;
  /** Address the shared web listener binds to; 127.0.0.1 when a reverse proxy (Caddy) fronts it. */
  httpBind?: string;
  /** Password for the admin-panel plugin (HTTP Basic auth). */
  adminPassword?: string;
  /** Named admin logins as scrypt hashes: name:scrypt:salt:hash,... (see `wd admin-hash`). */
  adminUsers?: string;
}
export interface PluginsFile {
  [pluginName: string]: { enabled?: boolean; [option: string]: unknown };
}
const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const truthy = (value: string | undefined): boolean =>
  ['1', 'true', 'yes'].includes((value ?? '').toLowerCase());
export function loadEnv(): void {
  if (!process.env.RCON_HOST && fs.existsSync('.env')) {
    try {
      process.loadEnvFile('.env');
    } catch {
      /* optional */
    }
  }
}
export function loadRconConfig(env: NodeJS.ProcessEnv = process.env): RconConfig {
  const missing = ['RCON_HOST', 'RCON_PASSWORD'].filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  const scheme = env.RCON_SCHEME === 'http' ? 'http' : 'https';
  return {
    host: env.RCON_HOST!,
    password: env.RCON_PASSWORD!,
    port: num(env.RCON_PORT, 7776),
    scheme,
    tlsInsecure: truthy(env.RCON_TLS_INSECURE),
    caFile: env.RCON_CA_FILE || undefined,
    timeoutMs: num(env.RCON_TIMEOUT_MS, 10000),
  };
}
export function loadHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const level = env.LOG_LEVEL;
  return {
    pollMs: num(env.POLL_MS, 4000),
    auditPollMs: num(env.AUDIT_POLL_MS, 15000),
    dataDir: env.DATA_DIR || './data',
    logLevel: level === 'debug' || level === 'warn' || level === 'error' ? level : 'info',
    pluginsFile: env.PLUGINS_FILE || './plugins.json',
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL || undefined,
    discordBotToken: env.DISCORD_BOT_TOKEN || undefined,
    discordInvite: env.DISCORD_INVITE?.trim() || undefined,
    steamApiKey: env.STEAM_API_KEY || undefined,
    httpPort: env.HTTP_PORT ? num(env.HTTP_PORT, 0) || undefined : undefined,
    httpBind: env.HTTP_BIND || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    adminUsers: env.ADMIN_USERS || undefined,
  };
}
export function loadPluginsFile(path: string): PluginsFile {
  if (!fs.existsSync(path)) {
    console.warn(`plugins file not found: ${path}; using no plugins`);
    return {};
  }
  const data: unknown = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`Invalid plugins file: ${path}`);
  const result: PluginsFile = {};
  for (const [key, value] of Object.entries(data))
    if (key !== '$comment' && value && typeof value === 'object' && !Array.isArray(value))
      result[key] = value as PluginsFile[string];
  return result;
}
