/** welcome with greetReturning off: a known player gets nothing, a newcomer still gets the DM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import welcome from '../plugins/welcome.ts';
import { player, sleep, startMockServer, waitFor } from './mock-server.ts';
import { makeHost, requestsTo, seedState } from './helpers.ts';

test('welcome: greetReturning=false is silent for anyone the host has seen before', async () => {
  const s = await startMockServer();
  const { host, dataDir } = makeHost(s, [welcome], {
    welcome: { delayMs: 20, message: 'hi {name}', greetReturning: false },
  });
  seedState(dataDir, 'welcome', { seen: { old: '2026-09-01T00:00:00Z' } });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    s.state.players.push(player('old'), player('fresh'));
    await waitFor(
      () => requestsTo(s, 'POST', '/v1/players/fresh/message').length === 1,
      2000,
      'newcomer welcomed',
    );
    await sleep(120);
    assert.equal(requestsTo(s, 'POST', '/v1/players/old/message').length, 0, 'known player: nothing');
    // The newcomer is now known too: leaving and coming back is silent.
    s.state.players = [];
    await sleep(80);
    s.state.players.push(player('fresh'));
    await sleep(150);
    assert.equal(requestsTo(s, 'POST', '/v1/players/fresh/message').length, 1, 'no second welcome');
  } finally {
    await host.stop();
    await s.close();
  }
});
