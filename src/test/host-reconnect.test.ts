/**
 * Map changes drop everyone and they reconnect: that is one session, not a leave and a join per player.
 * Also: a new match is detected without matchSeconds (the live build omits it).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { definePlugin } from '../host/plugin.ts';
import type { EventName, Events } from '../host/events.ts';
import { player, sleep, startMockServer, waitFor } from './mock-server.ts';
import { makeHost } from './helpers.ts';

type Seen = Array<{ event: EventName; payload: unknown }>;
const recorder = (seen: Seen) =>
  definePlugin({
    name: 'rec',
    description: '',
    setup(ctx) {
      for (const e of ['player.join', 'player.leave', 'match.new', 'match.map'] as const)
        ctx.on(e, (payload) => {
          seen.push({ event: e, payload });
        });
    },
  });
const of = <E extends EventName>(seen: Seen, e: E): Array<Events[E]> =>
  seen.filter((x) => x.event === e).map((x) => x.payload as Events[E]);

test('host: players who drop on a map change and come back inside the grace window keep their session', async () => {
  const roster = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => player(id));
  const s = await startMockServer({ state: { players: roster } });
  const seen: Seen = [];
  const { host } = makeHost(s, [recorder(seen)], {}, { reconnectGraceMs: 400 });
  try {
    await host.start();
    await waitFor(() => s.requests.filter((r) => r.path === '/v1/players').length >= 2);
    const t0 = Date.now();

    // Map change: everyone vanishes for a couple of polls, then most come back, one does not.
    s.state.map = 'Zestafona';
    s.state.players = [];
    await sleep(120);
    assert.equal(of(seen, 'match.map').length, 1, 'map change seen');
    assert.equal(of(seen, 'match.new').length, 1, 'a map change is a new match, even without matchSeconds');
    assert.equal(of(seen, 'player.leave').length, 0, 'leaves are held during the window');
    s.state.players = roster.filter((p) => p.steamId !== 'j');
    s.state.players.push(player('new')); // a genuinely new player joining mid-window
    await sleep(120);
    assert.equal(of(seen, 'player.join').length, 1, 'only the new player joins');
    assert.equal(of(seen, 'player.join')[0]!.player.steamId, 'new');

    await waitFor(
      () => of(seen, 'player.leave').length === 1,
      2000,
      'the missing player leaves after the window',
    );
    const gone = of(seen, 'player.leave')[0]!;
    assert.equal(gone.player.steamId, 'j');
    assert.ok(
      gone.observedSeconds * 1000 <= Date.now() - t0,
      'session ended when they vanished, not when the window closed',
    );
    assert.equal(of(seen, 'player.join').length, 1, 'no join storm for the nine who came back');

    // After the window, normal behaviour: a leave is immediate.
    s.state.players = s.state.players.filter((p) => p.steamId !== 'a');
    await waitFor(() => of(seen, 'player.leave').length === 2, 2000, 'ordinary leave');
    assert.equal(of(seen, 'player.leave')[1]!.player.steamId, 'a');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('host: a mass drop without a map change also opens the window', async () => {
  const roster = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => player(id));
  const s = await startMockServer({ state: { players: roster } });
  const seen: Seen = [];
  const { host } = makeHost(s, [recorder(seen)], {}, { reconnectGraceMs: 300 });
  try {
    await host.start();
    await waitFor(() => s.requests.filter((r) => r.path === '/v1/players').length >= 2);
    s.state.players = roster.slice(0, 2); // 6 of 8 gone at once
    await sleep(100);
    assert.equal(of(seen, 'player.leave').length, 0, 'held');
    s.state.players = roster;
    await sleep(500);
    assert.equal(of(seen, 'player.leave').length, 0, 'they came back: no leaves');
    assert.equal(of(seen, 'player.join').length, 0, 'and no joins');
    // One player leaving is not a mass drop: immediate.
    s.state.players = roster.slice(1);
    await waitFor(() => of(seen, 'player.leave').length === 1, 2000, 'single leave');
  } finally {
    await host.stop();
    await s.close();
  }
});
