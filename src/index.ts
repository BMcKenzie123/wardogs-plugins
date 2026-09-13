import { loadEnv, loadHostConfig, loadPluginsFile, loadRconConfig } from './config.ts';
import { createLogger } from './host/logger.ts';
import { PluginHost } from './host/host.ts';
import { registry } from './host/registry.ts';
import { RconClient } from './rcon/client.ts';

loadEnv();

const config = loadHostConfig();
const logger = createLogger(config.logLevel, 'host');

let rcon: RconClient;
try {
  rcon = new RconClient(loadRconConfig(), { logger: logger.child('rcon') });
} catch (e) {
  logger.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const host = new PluginHost({
  rcon,
  config,
  plugins: loadPluginsFile(config.pluginsFile),
  registry,
  logger,
});

logger.info(`wardogs-plugins starting → ${rcon.baseUrl} (poll ${config.pollMs} ms, data ${config.dataDir})`);

host.start().catch((e: unknown) => {
  logger.error('host failed to start', e);
  process.exit(1);
});

let stopping = false;
const stop = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  logger.info(`${signal} received; stopping`);
  host
    .stop()
    .catch((e: unknown) => logger.error('error during stop', e))
    .finally(() => process.exit(0));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
