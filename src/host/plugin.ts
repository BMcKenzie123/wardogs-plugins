import type { HostConfig } from '../config.ts';
import type { RconClient } from '../rcon/client.ts';
import type { Capabilities } from '../rcon/types.ts';
import type { EventName, Events, Snapshot } from './events.ts';
import type { Logger } from './logger.ts';
import type { Store } from './store.ts';
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
  snapshot(): Snapshot | null;
  serverUp(): boolean;
  lastPollAt(): number | null;
  /** Register cleanup to run when the host stops (close listeners, clear timers). */
  onStop(fn: () => void | Promise<void>): void;
  hasRoute(method: string, pathTemplate: string): boolean;
}
export interface Plugin<O = Record<string, unknown>> {
  name: string;
  description: string;
  defaults?: Partial<O>;
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
