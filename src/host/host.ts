import fs from 'node:fs/promises';
import path from 'node:path';
import { RconClient } from '../rcon/client.ts';
import type { HostConfig, PluginsFile } from '../config.ts';
import type { Capabilities, Player } from '../rcon/types.ts';
import type { Events, EventName, Snapshot } from './events.ts';
import type { Logger } from './logger.ts';
import type { AnyPlugin, PluginContext } from './plugin.ts';
import { Store } from './store.ts';
export class PluginHost {
  private rcon: RconClient;
  private config: HostConfig;
  private plugins: PluginsFile;
  private registry: Record<string, AnyPlugin>;
  private logger: Logger;
  private caps!: Capabilities;
  private handlers: { [K in EventName]?: Array<(p: Events[K]) => void | Promise<void>> } = {};
  private stores: Store[] = [];
  private enabled: AnyPlugin[] = [];
  private timers = new Set<NodeJS.Timeout>();
  private pollTimer?: NodeJS.Timeout;
  private auditTimer?: NodeJS.Timeout;
  private stopped = false;
  private latest: Snapshot | null = null;
  private previous: Snapshot | null = null;
  private up: boolean | undefined;
  private downSince?: number;
  private joinedAt = new Map<string, number | null>();
  private lastSeen = new Map<string, Player>();
  private auditKeys = new Set<string>();
  private auditSeeded = false;
  constructor(args: {
    rcon: RconClient;
    config: HostConfig;
    plugins: PluginsFile;
    registry: Record<string, AnyPlugin>;
    logger: Logger;
  }) {
    this.rcon = args.rcon;
    this.config = args.config;
    this.plugins = args.plugins;
    this.registry = args.registry;
    this.logger = args.logger;
  }
  async start(): Promise<void> {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    while (!this.stopped) {
      try {
        this.caps = await this.rcon.capabilities();
        break;
      } catch (e) {
        this.logger.error('capabilities unavailable; retrying', e);
        await new Promise<void>((r) => setTimeout(r, this.config.pollMs));
      }
    }
    if (this.stopped) return;
    this.logger.info(`capabilities: ${this.caps.routes.length} routes`);
    for (const [name, file] of Object.entries(this.plugins)) {
      if (file.enabled !== true) continue;
      const plugin = this.registry[name];
      if (!plugin) {
        this.logger.warn(`unknown plugin ${name}`);
        continue;
      }
      const missing = (plugin.requires ?? []).filter(([m, p]) => !RconClient.hasRoute(this.caps, m, p));
      if (missing.length) {
        this.logger.warn(`skipping ${name}; missing ${missing.map(([m, p]) => `${m} ${p}`).join(', ')}`);
        continue;
      }
      const store = new Store(
        path.join(this.config.dataDir, 'state', `${name}.json`),
        this.logger.child(name),
      );
      await store.load();
      this.stores.push(store);
      const options = { ...(plugin.defaults ?? {}), ...file };
      delete (options as { enabled?: unknown }).enabled;
      const ctx: PluginContext = {
        name,
        rcon: this.rcon,
        log: this.logger.child(name),
        options,
        state: store,
        capabilities: this.caps,
        host: this.config,
        on: (event, handler) => {
          const list = this.handlers[event] ?? [];
          list.push(handler as never);
          this.handlers[event] = list as never;
        },
        every: (ms, fn, opts = {}) => this.every(name, ms, fn, opts),
        // null while the server is unreachable, so timed plugins don't act on a stale picture.
        snapshot: () => (this.up === false ? null : this.latest),
        hasRoute: (m, p) => RconClient.hasRoute(this.caps, m, p),
      };
      try {
        await plugin.setup(ctx);
        this.enabled.push(plugin);
        this.logger.info(`enabled ${name}`);
      } catch (e) {
        this.logger.error(`setup failed ${name}`, e);
      }
    }
    if (!this.enabled.length) this.logger.warn('no plugins enabled');
    this.schedulePoll(0); // first poll immediately, then every pollMs
    if (this.handlers['audit.entry']?.length) this.scheduleAudit();
  }
  private every(
    owner: string,
    ms: number,
    fn: () => void | Promise<void>,
    opts: { immediate?: boolean },
  ): () => void {
    let active = true;
    const run = async (): Promise<void> => {
      if (!active || this.stopped) return;
      try {
        await fn();
      } catch (e) {
        this.logger.child(owner).error('timer handler failed', e);
      }
      if (!active || this.stopped) return;
      const t = setTimeout(() => {
        this.timers.delete(t);
        void run();
      }, ms);
      this.timers.add(t);
    };
    if (opts.immediate) void run();
    else {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void run();
      }, ms);
      this.timers.add(t);
    }
    return () => {
      active = false;
    };
  }
  /** setTimeout chain (not setInterval) so a slow poll never overlaps the next one. */
  private schedulePoll(delayMs = this.config.pollMs): void {
    this.pollTimer = setTimeout(async () => {
      await this.poll();
      if (!this.stopped) this.schedulePoll();
    }, delayMs);
  }
  private async poll(): Promise<void> {
    const now = Date.now();
    try {
      const [status, players] = await Promise.all([this.rcon.status(), this.rcon.players()]);
      const snap: Snapshot = { at: now, status, players: players.players };
      const recovered = this.up === false;
      if (recovered) {
        await this.emit('server.up', {
          snapshot: snap,
          downForMs: this.downSince === undefined ? null : now - this.downSince,
        });
        this.previous = null;
      }
      this.up = true;
      this.downSince = undefined;
      this.latest = snap;
      // A baseline (first poll, or first poll after an outage) resets the roster we track, so players who
      // came or went while we were blind never surface as join/leave events. Their session start is unknown.
      const baseline = this.previous === null;
      if (baseline) {
        this.lastSeen.clear();
        this.joinedAt.clear();
      }
      for (const p of snap.players) {
        if (!this.lastSeen.has(p.steamId)) this.joinedAt.set(p.steamId, baseline ? null : now);
        this.lastSeen.set(p.steamId, p);
      }
      if (this.previous) await this.diff(this.previous, snap);
      await this.emit('tick', { snapshot: snap, previous: this.previous });
      this.previous = snap;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (this.up !== false) {
        await this.emit('server.down', { error: err });
        this.logger.warn('server down', err);
      } else this.logger.debug('server still down', err);
      this.up = false;
      this.downSince ??= now;
    }
  }
  private async diff(old: Snapshot, next: Snapshot): Promise<void> {
    const a = old.status,
      b = next.status;
    if (b.matchSeconds < a.matchSeconds) await this.emit('match.new', { snapshot: next, previous: old });
    if (
      a.map !== b.map ||
      a.alternator !== b.alternator ||
      JSON.stringify([...a.experiences].sort()) !== JSON.stringify([...b.experiences].sort())
    )
      await this.emit('match.map', { from: a, to: b, snapshot: next });
    if (a.lighting !== b.lighting)
      await this.emit('match.lighting', { from: a.lighting, to: b.lighting, snapshot: next });
    if (JSON.stringify(a.factionScores) !== JSON.stringify(b.factionScores))
      await this.emit('score.changed', { from: a.factionScores, to: b.factionScores, snapshot: next });
    const current = new Set(next.players.map((p) => p.steamId));
    for (const [id, p] of this.lastSeen)
      if (!current.has(id)) {
        const start = this.joinedAt.get(id);
        await this.emit('player.leave', {
          player: p,
          snapshot: next,
          sessionSeconds:
            start === null || start === undefined ? null : Math.max(0, (next.at - start) / 1000),
        });
        this.lastSeen.delete(id);
        this.joinedAt.delete(id);
      }
    const prior = new Set(old.players.map((p) => p.steamId));
    for (const p of next.players)
      if (!prior.has(p.steamId)) await this.emit('player.join', { player: p, snapshot: next });
  }
  private scheduleAudit(): void {
    this.auditTimer = setTimeout(async () => {
      // Don't hammer (or spam the log about) a server the poll loop already knows is down.
      if (this.up === false) {
        if (!this.stopped) this.scheduleAudit();
        return;
      }
      try {
        const entries = (await this.rcon.audit(100)).entries;
        const keys = new Set(entries.map((e) => `${e.timestampUtc}|${e.sessionId}|${e.event}|${e.detail}`));
        if (this.auditSeeded)
          for (const entry of [...entries].sort((a, b) => a.timestampUtc.localeCompare(b.timestampUtc)))
            if (
              !this.auditKeys.has(`${entry.timestampUtc}|${entry.sessionId}|${entry.event}|${entry.detail}`)
            )
              await this.emit('audit.entry', { entry });
        this.auditKeys = keys;
        this.auditSeeded = true;
      } catch (e) {
        this.logger.warn('audit poll failed', e);
      }
      if (!this.stopped) this.scheduleAudit();
    }, this.config.auditPollMs);
  }
  async emit<E extends EventName>(event: E, payload: Events[E]): Promise<void> {
    for (const handler of this.handlers[event] ?? [])
      try {
        await handler(payload as never);
      } catch (e) {
        this.logger.error(`event=${event}`, e);
      }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.auditTimer) clearTimeout(this.auditTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const plugin of this.enabled)
      try {
        await plugin.teardown?.();
      } catch (e) {
        this.logger.error(`teardown failed ${plugin.name}`, e);
      }
    await Promise.all(this.stores.map((s) => s.flush()));
  }
}
