/** Runtime enable/disable of plugins, persistence to the plugins file, and the log buffer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginHost } from '../host/host.ts';
import { LogBuffer, createLogger } from '../host/logger.ts';
import { definePlugin } from '../host/plugin.ts';
import { RconClient } from '../rcon/client.ts';
import type { PluginContext } from '../host/plugin.ts';
import { player, sleep, startMockServer, TOKEN, waitFor } from './mock-server.ts';
import { requestsTo } from './helpers.ts';

test('host: plugins can be switched on and off at runtime and the choice is persisted', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const pluginsFile = path.join(dataDir, 'plugins.json');
  fs.writeFileSync(
    pluginsFile,
    JSON.stringify(
      { $comment: 'keep me', ticker: { enabled: false, note: 'x' }, greeter: { enabled: true } },
      null,
      2,
    ),
  );

  let ticks = 0;
  let timerRuns = 0;
  let stops = 0;
  let captured: PluginContext<unknown> | undefined;
  const ticker = definePlugin({
    name: 'ticker',
    description: 'counts ticks',
    setup(ctx) {
      ctx.on('tick', () => {
        ticks += 1;
      });
      ctx.every(30, () => {
        timerRuns += 1;
      });
      ctx.onStop(() => {
        stops += 1;
      });
    },
  });
  const greeter = definePlugin({
    name: 'greeter',
    description: 'holds the context',
    setup(ctx) {
      captured = ctx;
    },
  });
  const buffer = new LogBuffer(50);
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: { pollMs: 20, auditPollMs: 1000, dataDir, logLevel: 'error', pluginsFile },
    plugins: JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, { enabled?: boolean }>,
    registry: { ticker, greeter },
    logger: createLogger('info', 'host', (line) => buffer.push(line)),
    logBuffer: buffer,
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 2);
    assert.equal(ticks, 0, 'disabled plugin sees nothing');
    assert.deepEqual(
      host.listPlugins().map((p) => `${p.name}:${p.state}`),
      ['ticker:disabled', 'greeter:enabled'],
    );

    await captured!.setPluginEnabled('ticker', true);
    await waitFor(() => ticks >= 2 && timerRuns >= 1, 2000, 'ticker running');
    assert.equal(host.listPlugins().find((p) => p.name === 'ticker')?.state, 'enabled');
    let saved = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.equal(saved.ticker?.enabled, true);
    assert.equal(saved.ticker?.note, 'x', 'other options preserved');
    assert.equal(saved.$comment, 'keep me');

    await captured!.setPluginEnabled('ticker', false);
    assert.equal(stops, 1, 'stop hook ran');
    const ticksAtDisable = ticks;
    const timersAtDisable = timerRuns;
    await sleep(120);
    assert.equal(ticks, ticksAtDisable, 'no ticks after disable');
    assert.equal(timerRuns, timersAtDisable, 'no timer runs after disable');
    saved = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.equal(saved.ticker?.enabled, false);

    const lines = captured!.recentLog(10);
    assert.ok(
      lines.some((l) => l.includes('enabled ticker')),
      'log buffer captured the enable',
    );
    assert.ok(
      lines.some((l) => l.includes('disabled ticker')),
      'log buffer captured the disable',
    );

    await assert.rejects(() => captured!.setPluginEnabled('nope', true), /unknown plugin/);
  } finally {
    await host.stop();
    await s.close();
  }
});
