import type { HostConfig } from '../config.ts';
import type { RconClient } from '../rcon/client.ts';
import type { Capabilities } from '../rcon/types.ts';
import type { EventName, Events, Snapshot } from './events.ts';
import type { Logger } from './logger.ts';
import type { Store } from './store.ts';

/** What the host knows about one registered plugin right now. */
export interface PluginStatus {
  name: string;
  description: string;
  /** enabled = running; disabled = off in config; skipped = required route missing; failed = setup threw. */
  state: 'enabled' | 'disabled' | 'skipped' | 'failed';
  note?: string;
  /** The plugin's built-in defaults (used to type the option editor). */
  defaults: Record<string, unknown>;
  /** Effective options: defaults overlaid with what the plugins file sets. */
  options: Record<string, unknown>;
  /** Allowed values for string options that have a fixed set (rendered as a dropdown). */
  choices: Record<string, string[]>;
}

export interface PluginContext<O = Record<string, unknown>> {
  readonly name: string;
  readonly rcon: RconClient;
  readonly log: Logger;
  readonly options: O;
  readonly state: Store;
  readonly capabilities: Capabilities;
  readonly host: HostConfig;
  on<E extends EventName>(event: E, handler: (payload: Events[E]) => void | Promise<void>): void;
  every(ms: number, fn: () => void | Promise<void>, opts?: { immediate?: boolean }): () => void;
  /** Latest successful poll, or null while the server is unreachable. */
  snapshot(): Snapshot | null;
  hasRoute(method: string, pathTemplate: string): boolean;
  serverUp(): boolean;
  lastPollAt(): number | null;
  /** Register cleanup to run when the host stops or this plugin is disabled (close listeners, clear timers). */
  onStop(fn: () => void | Promise<void>): void;
  /** Every registered plugin with its current state and options. */
  plugins(): PluginStatus[];
  /** Turn a plugin on or off at runtime; the change is also written to the plugins file when possible. */
  setPluginEnabled(name: string, enabled: boolean): Promise<void>;
  /** Replace a plugin's configured options, persist them, and restart the plugin if it is running. */
  setPluginOptions(name: string, options: Record<string, unknown>): Promise<void>;
  /** Drop every configured option for a plugin (back to defaults), keeping its enabled state. */
  resetPluginOptions(name: string): Promise<void>;
  /** Stop and start a running plugin with its current options. */
  restartPlugin(name: string): Promise<void>;
  /** Most recent host log lines, newest last (empty when the host keeps no buffer). */
  recentLog(limit?: number): string[];
}

export interface Plugin<O = Record<string, unknown>> {
  name: string;
  description: string;
  defaults?: Partial<O>;
  /** Fixed value sets for string options (e.g. `{ mode: ['broadcast', 'dm'] }`); the panel shows a dropdown. */
  choices?: Partial<Record<keyof O & string, readonly string[]>>;
  requires?: Array<[method: string, pathTemplate: string]>;
  setup(ctx: PluginContext<O>): void | Promise<void>;
  teardown?(): void | Promise<void>;
}

export function definePlugin<O>(p: Plugin<O>): Plugin<O> {
  return p;
}

/** A plugin with any option type; used for registries that hold plugins with different option shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPlugin = Plugin<any>;
