/** The MOTD cadence survives restarts: the next line is due relative to the last send, not the restart. */
import test from 'node:test';
import assert from 'node:assert/strict';
import motd from '../plugins/motd.ts';
import { player, sleep, startMockServer, waitFor } from './mock-server.ts';
import { makeHost, requestsTo, seedState } from './helpers.ts';

test('motd: a restart does not push the next line a full interval away', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  // 30-minute interval, last sent 100 minutes ago: overdue, so the first line goes out right after start.
  const { host, dataDir } = makeHost(s, [motd], { motd: { intervalMinutes: 30, messages: ['one', 'two'] } });
  seedState(dataDir, 'motd', { index: 1, lastSentAt: Date.now() - 100 * 60_000 });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length === 1, 3000, 'overdue line sent');
    assert.deepEqual(JSON.parse(requestsTo(s, 'POST', '/v1/broadcast')[0]!.body), { message: 'two' });
    await sleep(200);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, 1, 'then waits a full interval');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('motd: never sent before means one full interval first; nothing while the server is empty', async () => {
  const s = await startMockServer();
  const { host } = makeHost(s, [motd], { motd: { intervalMinutes: 0.005, messages: ['hi'] } }); // 300 ms
  try {
    await host.start();
    await sleep(500);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, 0, 'empty server: no MOTD');
    s.state.players.push(player('a'));
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length >= 1, 3000, 'MOTD once someone is on');
  } finally {
    await host.stop();
    await s.close();
  }
});
