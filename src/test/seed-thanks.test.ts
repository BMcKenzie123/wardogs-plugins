import test from 'node:test';
import assert from 'node:assert/strict';
import seedThanks from '../plugins/seed-thanks.ts';
import { player, sleep, startMockServer, waitFor } from './mock-server.ts';
import { bodyOf, makeHost, requestsTo } from './helpers.ts';

test('seed-thanks (dm): thanks a player once they have seeded long enough, once per window', async () => {
  const s = await startMockServer({ state: { players: [player('a', { name: 'Ann' })] } });
  const { host } = makeHost(s, [seedThanks], {
    'seed-thanks': {
      mode: 'dm',
      belowPlayers: 5,
      afterMinutes: 0.002,
      oncePerHours: 1,
      message: 'Thanks {name} on {server}',
    },
  });
  try {
    await host.start();
    const dms = () => requestsTo(s, 'POST', '/v1/players/a/message');
    await waitFor(() => dms().length === 1, 2000, 'seed thank-you DM');
    assert.deepEqual(bodyOf(dms()[0]), { message: 'Thanks Ann on Mock Server' });
    await sleep(200);
    assert.equal(dms().length, 1, 'not repeated inside the window');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('seed-thanks (dm): a full server is not seeding', async () => {
  const s = await startMockServer({ state: { players: [player('a'), player('b'), player('c')] } });
  const { host } = makeHost(s, [seedThanks], {
    'seed-thanks': { mode: 'dm', belowPlayers: 3, afterMinutes: 0.001 },
  });
  try {
    await host.start();
    await sleep(200);
    assert.equal(s.requests.filter((r) => r.path.endsWith('/message')).length, 0);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('seed-thanks (broadcast): periodic broadcast while under-populated, nothing when empty', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(s, [seedThanks], {
    'seed-thanks': {
      mode: 'broadcast',
      belowPlayers: 5,
      broadcastEveryMinutes: 0.002,
      message: 'Thanks {name}!',
    },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length >= 2, 2000, 'two broadcasts');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/broadcast')[0]), { message: 'Thanks everyone!' });
    s.state.players = [];
    await sleep(60);
    const before = requestsTo(s, 'POST', '/v1/broadcast').length;
    await sleep(250);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, before, 'no broadcasts to an empty server');
  } finally {
    await host.stop();
    await s.close();
  }
});
