import fs from 'node:fs/promises';
import path from 'node:path';
import { RconClient } from '../rcon/client.ts';
import type { HostConfig, PluginsFile } from '../config.ts';
import type { Capabilities, Player } from '../rcon/types.ts';
import type { Events, EventName, Snapshot } from './events.ts';
import type { LogBuffer, Logger } from './logger.ts';
import type { AnyPlugin, PluginContext, PluginStatus } from './plugin.ts';
import { Store } from './store.ts';

type Handler = (payload: never) => void | Promise<void>;

interface Registered {
  owner: string;
  fn: Handler;
}

/** Everything one running plugin has registered, so it can be switched off cleanly. */
interface ActivePlugin {
  plugin: AnyPlugin;
  handlers: Array<{ event: EventName; fn: Handler }>;
  cancels: Array<() => void>;
  stops: Array<() => void | Promise<void>>;
  store: Store;
}

export class PluginHost {
  private rcon: RconClient;
  private config: HostConfig;
  private plugins: PluginsFile;
  private registry: Record<string, AnyPlugin>;
  private logger: Logger;
  private logBuffer: LogBuffer | undefined;
  private caps!: Capabilities;
  private handlers = new Map<EventName, Registered[]>();
  private active = new Map<string, ActivePlugin>();
  private status = new Map<string, PluginStatus>();
  private timers = new Set<NodeJS.Timeout>();
  private pollTimer?: NodeJS.Timeout;
  private auditTimer?: NodeJS.Timeout;
  private auditRunning = false;
  private polling = false;
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
    logBuffer?: LogBuffer;
  }) {
    this.rcon = args.rcon;
    this.config = args.config;
    this.plugins = args.plugins;
    this.registry = args.registry;
    this.logger = args.logger;
    this.logBuffer = args.logBuffer;
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
    for (const [name, plugin] of Object.entries(this.registry))
      this.status.set(name, { name, description: plugin.description, state: 'disabled' });
    for (const [name, file] of Object.entries(this.plugins)) {
      if (file.enabled !== true) continue;
      if (!this.registry[name]) {
        this.logger.warn(`unknown plugin ${name}`);
        continue;
      }
      await this.activate(name);
    }
    if (!this.active.size) this.logger.warn('no plugins enabled');
    this.polling = true;
    this.schedulePoll(0); // first poll immediately, then every pollMs
    this.ensureAuditLoop();
  }

  /** Current state of every registered plugin. */
  listPlugins(): PluginStatus[] {
    return [...this.status.values()];
  }

  /** Switch a plugin on or off while running, and record the choice in the plugins file. */
  async setPluginEnabled(name: string, enabled: boolean): Promise<void> {
    if (!this.registry[name]) throw new Error(`unknown plugin "${name}"`);
    if (enabled) {
      this.plugins[name] = { ...(this.plugins[name] ?? {}), enabled: true };
      if (!this.active.has(name)) await this.activate(name);
    } else {
      this.plugins[name] = { ...(this.plugins[name] ?? {}), enabled: false };
      await this.deactivate(name);
    }
    await this.persistEnabled(name, enabled);
  }

  private async persistEnabled(name: string, enabled: boolean): Promise<void> {
    const file = this.config.pluginsFile;
    try {
      const json = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, Record<string, unknown>>;
      json[name] = { ...(json[name] ?? {}), enabled };
      await fs.writeFile(file, JSON.stringify(json, null, 2) + '\n');
      this.logger.info(`saved ${name}.enabled=${enabled} to ${file}`);
    } catch (e) {
      this.logger.warn(`could not persist ${name}.enabled to ${file}`, e);
    }
  }

  private async activate(name: string): Promise<void> {
    const plugin = this.registry[name]!;
    const file = this.plugins[name] ?? {};
    const missing = (plugin.requires ?? []).filter(([m, p]) => !RconClient.hasRoute(this.caps, m, p));
    if (missing.length) {
      const note = `missing ${missing.map(([m, p]) => `${m} ${p}`).join(', ')}`;
      this.logger.warn(`skipping ${name}; ${note}`);
      this.status.set(name, { name, description: plugin.description, state: 'skipped', note });
      return;
    }
    const store = new Store(path.join(this.config.dataDir, 'state', `${name}.json`), this.logger.child(name));
    await store.load();
    const owned: ActivePlugin = { plugin, handlers: [], cancels: [], stops: [], store };
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
        const fn = handler as Handler;
        const list = this.handlers.get(event) ?? [];
        list.push({ owner: name, fn });
        this.handlers.set(event, list);
        owned.handlers.push({ event, fn });
      },
      every: (ms, fn, opts = {}) => {
        const cancel = this.every(name, ms, fn, opts);
        owned.cancels.push(cancel);
        return cancel;
      },
      // null while the server is unreachable, so timed plugins don't act on a stale picture.
      snapshot: () => (this.up === false ? null : this.latest),
      hasRoute: (m, p) => RconClient.hasRoute(this.caps, m, p),
      serverUp: () => this.up !== false,
      lastPollAt: () => this.latest?.at ?? null,
      onStop: (fn) => {
        owned.stops.push(fn);
      },
      plugins: () => this.listPlugins(),
      setPluginEnabled: (n, on) => this.setPluginEnabled(n, on),
      recentLog: (limit = 50) => this.logBuffer?.recent(limit) ?? [],
    };
    try {
      await plugin.setup(ctx);
      this.active.set(name, owned);
      this.status.set(name, { name, description: plugin.description, state: 'enabled' });
      this.logger.info(`enabled ${name}`);
    } catch (e) {
      this.logger.error(`setup failed ${name}`, e);
      this.status.set(name, {
        name,
        description: plugin.description,
        state: 'failed',
        note: e instanceof Error ? e.message : String(e),
      });
      await this.release(owned);
    }
    if (this.polling) this.ensureAuditLoop();
  }

  private async deactivate(name: string): Promise<void> {
    const owned = this.active.get(name);
    if (!owned) return;
    await this.release(owned);
    try {
      await owned.plugin.teardown?.();
    } catch (e) {
      this.logger.error(`teardown failed ${name}`, e);
    }
    this.active.delete(name);
    this.status.set(name, { name, description: owned.plugin.description, state: 'disabled' });
    this.logger.info(`disabled ${name}`);
  }

  /** Undo everything a plugin registered: stop hooks, timers, handlers; flush its state. */
  private async release(owned: ActivePlugin): Promise<void> {
    for (const stop of [...owned.stops].reverse())
      try {
        await stop();
      } catch (e) {
        this.logger.error('stop hook failed', e);
      }
    for (const cancel of owned.cancels) cancel();
    for (const { event, fn } of owned.handlers) {
      const list = this.handlers.get(event);
      if (list)
        this.handlers.set(
          event,
          list.filter((h) => h.fn !== fn),
        );
    }
    owned.stops = [];
    owned.cancels = [];
    owned.handlers = [];
    await owned.store.flush();
  }

  private every(
    owner: string,
    ms: number,
    fn: () => void | Promise<void>,
    opts: { immediate?: boolean },
  ): () => void {
    // A zero or tiny interval would spin the event loop; clamp and say so.
    const interval = Math.max(100, ms);
    if (interval !== ms) this.logger.child(owner).warn(`timer interval ${ms} ms clamped to ${interval} ms`);
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
      }, interval);
      this.timers.add(t);
    };
    if (opts.immediate) void run();
    else {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void run();
      }, interval);
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

  /** Start the audit poll loop once something subscribes to audit.entry. */
  private ensureAuditLoop(): void {
    if (this.auditRunning || this.stopped) return;
    if (!(this.handlers.get('audit.entry') ?? []).length) return;
    this.auditRunning = true;
    this.scheduleAudit();
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
    for (const { owner, fn } of [...(this.handlers.get(event) ?? [])])
      try {
        await fn(payload as never);
      } catch (e) {
        this.logger.child(owner).error(`event=${event}`, e);
      }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.auditTimer) clearTimeout(this.auditTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const name of [...this.active.keys()].reverse()) await this.deactivate(name);
  }
}
