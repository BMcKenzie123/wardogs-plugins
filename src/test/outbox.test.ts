/** The outbox paces every plugin message: per-minute limits, a gap per player, a bounded queue. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, governRcon } from '../host/outbox.ts';
import { createLogger } from '../host/logger.ts';
import { definePlugin } from '../host/plugin.ts';
import { RconClient } from '../rcon/client.ts';
import { player, sleep, startMockServer, TOKEN, waitFor } from './mock-server.ts';
import { makeHost, requestsTo } from './helpers.ts';

const log = createLogger('error');

test('outbox: a burst is paced to the per-minute limit, with a small initial burst', async () => {
  const sent: number[] = [];
  const box = new Outbox({ dmPerMinute: 600, dmGapPerPlayerMs: 0 }, log); // 10/s, burst 150 → use broadcasts
  const bc = new Outbox({ broadcastPerMinute: 240, dmGapPerPlayerMs: 0 }, log); // 4/s, burst 60
  const t0 = Date.now();
  for (let i = 0; i < 70; i += 1)
    bc.broadcast(`b${i}`, async () => {
      sent.push(Date.now() - t0);
    });
  await waitFor(() => sent.length === 70, 6000, 'all sent');
  assert.ok(sent[59]! < 100, 'the first 60 (burst) go out at once');
  assert.ok(sent[69]! >= 2000, `the last of 70 waited for tokens (${sent[69]} ms)`);
  bc.stop();
  box.stop();
});

test('outbox: the same player is not DMed twice inside the gap; others are not held up', async () => {
  const sent: string[] = [];
  const box = new Outbox({ dmPerMinute: 6000, dmGapPerPlayerMs: 300 }, log);
  const push = (id: string) => async () => {
    sent.push(id);
  };
  box.dm('a', 'a1', push('a1'));
  box.dm('a', 'a2', push('a2'));
  box.dm('b', 'b1', push('b1'));
  await sleep(50);
  assert.deepEqual(sent, ['a1', 'b1'], 'a2 waits for the gap; b1 is not blocked by a');
  await waitFor(() => sent.length === 3, 2000, 'a2 after the gap');
  assert.equal(sent[2], 'a2');
  box.stop();
});

test('outbox: beyond maxQueue the oldest waiting message of that kind is dropped', async () => {
  const sent: string[] = [];
  const box = new Outbox({ dmPerMinute: 60, dmGapPerPlayerMs: 0, maxQueue: 5 }, log); // burst 15 → all 15 go at once
  for (let i = 0; i < 15; i += 1) box.dm(`p${i}`, `m${i}`, async () => void sent.push(`m${i}`));
  await sleep(30);
  assert.equal(sent.length, 15, 'the burst goes out');
  for (let i = 15; i < 25; i += 1) box.dm(`p${i}`, `m${i}`, async () => void sent.push(`m${i}`));
  const stats = box.stats();
  assert.equal(stats.queued, 5, 'queue bounded');
  assert.equal(stats.dropped, 5, 'oldest waiting dropped');
  box.stop();
});

test('governRcon: message and broadcast queue; everything else passes straight through', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const client = new RconClient({
    host: '127.0.0.1',
    port: s.port,
    scheme: 'http',
    password: TOKEN,
    tlsInsecure: false,
    timeoutMs: 1000,
  });
  const box = new Outbox({ dmPerMinute: 6000, broadcastPerMinute: 6000, dmGapPerPlayerMs: 0 }, log);
  const governed = governRcon(client, box);
  try {
    const status = await governed.status();
    assert.equal(status.map, 'Kavkazi', 'reads pass through with the right this');
    await governed.message('a', 'hi');
    await governed.broadcast('all');
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length === 1, 2000, 'broadcast sent');
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/a/message').length === 1, 2000, 'dm sent');
    assert.equal(governed.raw, client);
    assert.deepEqual(governed.outbox, { queued: 0, dropped: 0 });
  } finally {
    box.stop();
    client.close();
    await s.close();
  }
});

test('host: plugin messages are paced; a plugin that fires 30 DMs at once gets them out over time', async () => {
  const roster = Array.from({ length: 30 }, (_, i) => player(`p${i}`));
  const s = await startMockServer({ state: { players: roster } });
  const spammer = definePlugin({
    name: 'spammer',
    description: '',
    setup(ctx) {
      let done = false;
      ctx.on('tick', async ({ snapshot }) => {
        if (done) return;
        done = true;
        for (const p of snapshot.players) await ctx.rcon.message(p.steamId, 'hey');
      });
    },
  });
  const { host } = makeHost(s, [spammer], {}, { outbox: { dmPerMinute: 600, dmGapPerPlayerMs: 0 } }); // 10/s, burst 150
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    await sleep(150);
    const dms = () => s.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/message')).length;
    assert.equal(dms(), 30, 'within the burst: all out, and the tick handler was never blocked');
  } finally {
    await host.stop();
    await s.close();
  }
});
