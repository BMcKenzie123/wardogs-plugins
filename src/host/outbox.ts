import type { RconClient } from '../rcon/client.ts';
import type { Logger } from './logger.ts';

/**
 * One queue for everything the plugins say to players. Plugins fire messages whenever their own
 * logic says so; on a full server that adds up to bursts nobody wants (67 DMs in one second, 100
 * welcomes in five minutes). The outbox paces them: a token bucket per kind (DMs, broadcasts), a
 * minimum gap between two DMs to the same player, and a bounded queue that drops the oldest when a
 * plugin goes wild. Admin actions from the panel bypass it through `raw`.
 */
export interface OutboxConfig {
  /** DMs per minute across every plugin. Default 12. */
  dmPerMinute: number;
  /** Broadcasts per minute across every plugin. Default 4. */
  broadcastPerMinute: number;
  /** A player is not DMed again within this many ms. Default 180 000 (3 min). */
  dmGapPerPlayerMs: number;
  /** Queue bound; beyond it the oldest waiting message of that kind is dropped. Default 200. */
  maxQueue: number;
}

export const OUTBOX_DEFAULTS: OutboxConfig = {
  dmPerMinute: 12,
  broadcastPerMinute: 4,
  dmGapPerPlayerMs: 180_000,
  maxQueue: 200,
};

type Kind = 'dm' | 'broadcast';

interface Job {
  kind: Kind;
  /** steamId for DMs (per-player gap); undefined for broadcasts. */
  key?: string;
  label: string;
  run: () => Promise<unknown>;
  enqueuedAt: number;
}

export class Outbox {
  private cfg: OutboxConfig;
  private log: Logger;
  private queue: Job[] = [];
  private tokens: Record<Kind, number>;
  private burst: Record<Kind, number>;
  private lastRefill = Date.now();
  private lastDm = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private dropped = 0;
  private lastWarn = 0;

  constructor(cfg: Partial<OutboxConfig>, log: Logger) {
    this.cfg = { ...OUTBOX_DEFAULTS, ...cfg };
    this.log = log;
    // A small burst so the first few messages after a quiet spell go out at once.
    this.burst = {
      dm: Math.max(1, Math.round(this.cfg.dmPerMinute / 4)),
      broadcast: Math.max(1, Math.round(this.cfg.broadcastPerMinute / 4)),
    };
    this.tokens = { ...this.burst };
  }

  /** Waiting messages and how many were dropped since start. */
  stats(): { queued: number; dropped: number } {
    return { queued: this.queue.length, dropped: this.dropped };
  }

  dm(steamId: string, label: string, run: () => Promise<unknown>): void {
    this.enqueue({ kind: 'dm', key: steamId, label, run, enqueuedAt: Date.now() });
  }

  broadcast(label: string, run: () => Promise<unknown>): void {
    this.enqueue({ kind: 'broadcast', label, run, enqueuedAt: Date.now() });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }

  private enqueue(job: Job): void {
    if (this.stopped) return;
    if (this.queue.length >= this.cfg.maxQueue) {
      const idx = this.queue.findIndex((j) => j.kind === job.kind);
      const victim = idx >= 0 ? this.queue.splice(idx, 1)[0] : this.queue.shift();
      this.dropped += 1;
      if (victim && Date.now() - this.lastWarn > 60_000) {
        this.lastWarn = Date.now();
        this.log.warn(`outbox full (${this.cfg.maxQueue}); dropping oldest, e.g. ${victim.label}`);
      }
    }
    this.queue.push(job);
    this.pump();
  }

  private refill(): void {
    const now = Date.now();
    const minutes = (now - this.lastRefill) / 60_000;
    this.lastRefill = now;
    this.tokens.dm = Math.min(this.burst.dm, this.tokens.dm + minutes * this.cfg.dmPerMinute);
    this.tokens.broadcast = Math.min(
      this.burst.broadcast,
      this.tokens.broadcast + minutes * this.cfg.broadcastPerMinute,
    );
  }

  /** Send everything that may go now; schedule a wake-up for the earliest thing that may not. */
  private pump(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.refill();
    const now = Date.now();
    let waitMs = Infinity;
    for (let i = 0; i < this.queue.length;) {
      const job = this.queue[i]!;
      const gapLeft =
        job.key !== undefined ? (this.lastDm.get(job.key) ?? -Infinity) + this.cfg.dmGapPerPlayerMs - now : 0;
      if (gapLeft > 0) {
        waitMs = Math.min(waitMs, gapLeft);
        i += 1;
        continue;
      }
      if (this.tokens[job.kind] < 1) {
        const perMs = (job.kind === 'dm' ? this.cfg.dmPerMinute : this.cfg.broadcastPerMinute) / 60_000;
        waitMs = Math.min(waitMs, Math.ceil((1 - this.tokens[job.kind]) / perMs));
        i += 1;
        continue;
      }
      this.queue.splice(i, 1);
      this.tokens[job.kind] -= 1;
      if (job.key !== undefined) this.lastDm.set(job.key, now);
      job.run().catch((e: unknown) => this.log.warn(`${job.label} failed`, e));
    }
    if (this.queue.length && Number.isFinite(waitMs)) {
      this.timer = setTimeout(() => this.pump(), Math.max(50, waitMs));
      if (this.queue.length >= 20 && now - this.lastWarn > 60_000) {
        this.lastWarn = now;
        this.log.info(
          `outbox: ${this.queue.length} messages waiting (limits ${this.cfg.dmPerMinute} DMs and ${this.cfg.broadcastPerMinute} broadcasts per minute, ${Math.round(this.cfg.dmGapPerPlayerMs / 1000)} s per player)`,
        );
      }
    }
  }
}

/** An RconClient whose `message` and `broadcast` go through the outbox; everything else passes through. */
export interface GovernedRcon extends RconClient {
  /** The ungoverned client, for admin actions that must go out now. */
  readonly raw: RconClient;
  /** Waiting messages and drops. */
  readonly outbox: { queued: number; dropped: number };
}

export function governRcon(client: RconClient, outbox: Outbox): GovernedRcon {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'raw') return target;
      if (prop === 'outbox') return outbox.stats();
      if (prop === 'message')
        return (steamId: string, text: string) => {
          outbox.dm(steamId, `DM to ${steamId}`, () => target.message(steamId, text));
          return Promise.resolve({ queued: true });
        };
      if (prop === 'broadcast')
        return (text: string) => {
          outbox.broadcast(`broadcast "${text.slice(0, 40)}"`, () => target.broadcast(text));
          return Promise.resolve({ queued: true });
        };
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as GovernedRcon;
}
