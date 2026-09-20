/** The host must come up with the game server unreachable, then re-check route requirements on server.up. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { definePlugin } from '../host/plugin.ts';
import type { EventName } from '../host/events.ts';
import { player, sleep, startMockServer, waitFor } from './mock-server.ts';
import { makeHost } from './helpers.ts';

test('host: starts without capabilities, enables plugins, then enforces requires once the server answers', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const port = s.port;
  await s.close(); // server "down" while the host starts

  const seen: EventName[] = [];
  let gatedSetups = 0;
  const rec = definePlugin({
    name: 'rec',
    description: 'records events',
    setup(ctx) {
      for (const e of ['tick', 'server.up', 'server.down'] as EventName[]) ctx.on(e, () => void seen.push(e));
    },
  });
  const gated = definePlugin({
    name: 'gated',
    description: 'needs faction moves',
    requires: [['PATCH', '/v1/players/{id}']],
    setup() {
      gatedSetups += 1;
    },
  });
  const { host } = makeHost(s, [rec, gated], {}, { pollMs: 20 });
  try {
    const started = Date.now();
    await host.start();
    assert.ok(Date.now() - started < 2000, 'start() returns promptly while the server is down');
    assert.deepEqual(
      host.listPlugins().map((p) => `${p.name}:${p.state}`),
      ['rec:enabled', 'gated:enabled'],
      'both run while requirements cannot be verified',
    );
    assert.equal(gatedSetups, 1);
    await waitFor(() => seen.includes('server.down'), 2000, 'server.down');

    // Server comes back WITHOUT the faction route: gated must be stopped, rec keeps ticking.
    const s2 = await startMockServer({
      port,
      state: {
        routes: ['GET /v1/status', 'GET /v1/players', 'GET /v1/capabilities'],
        players: [player('a')],
      },
    });
    try {
      await waitFor(() => seen.includes('server.up'), 3000, 'server.up');
      await waitFor(
        () => host.listPlugins().find((p) => p.name === 'gated')?.state === 'skipped',
        2000,
        'gated skipped',
      );
      assert.match(host.listPlugins().find((p) => p.name === 'gated')?.note ?? '', /PATCH \/v1\/players/);
      const ticks = seen.filter((e) => e === 'tick').length;
      await sleep(80);
      assert.ok(seen.filter((e) => e === 'tick').length > ticks, 'rec still receives ticks');
    } finally {
      await host.stop();
      await s2.close();
    }
  } catch (e) {
    await host.stop();
    throw e;
  }
});
