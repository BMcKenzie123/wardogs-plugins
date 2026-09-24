import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginHost } from '../host/host.ts';
import { createLogger } from '../host/logger.ts';
import { definePlugin } from '../host/plugin.ts';
import { RconClient } from '../rcon/client.ts';
import type { EventName, Events } from '../host/events.ts';
import type { Plugin } from '../host/plugin.ts';
import { player, sleep, startMockServer, TOKEN, waitFor, type MockServer } from './mock-server.ts';

type Seen = Array<{ event: EventName; payload: unknown }>;

/** A recorder plugin that pushes every event it sees into `seen`. */
function recorder(seen: Seen, events: EventName[]): Plugin {
  return definePlugin({
    name: 'rec',
    description: 'records events',
    setup(ctx) {
      for (const e of events) ctx.on(e, (payload) => void seen.push({ event: e, payload }));
    },
  });
}

function makeHost(
  s: MockServer,
  plugin: Plugin,
  opts: { pollMs?: number; auditPollMs?: number; timeoutMs?: number } = {},
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: opts.timeoutMs ?? 500,
    }),
    config: {
      pollMs: opts.pollMs ?? 20,
      auditPollMs: opts.auditPollMs ?? 30,
      dataDir,
      logLevel: 'error',
      pluginsFile: 'unused',
    },
    plugins: { [plugin.name]: { enabled: true } },
    registry: { [plugin.name]: plugin },
    logger: createLogger('error'),
  });
  return { host, dataDir };
}

const of = <E extends EventName>(seen: Seen, e: E): Array<Events[E]> =>
  seen.filter((x) => x.event === e).map((x) => x.payload as Events[E]);

test('host: first snapshot is a baseline (no join events), then joins/leaves are diffed', async () => {
  const s = await startMockServer({ state: { players: [player('A')] } });
  const seen: Seen = [];
  const { host } = makeHost(s, recorder(seen, ['tick', 'player.join', 'player.leave']));
  try {
    await host.start();
    await waitFor(() => of(seen, 'tick').length >= 2, 2000, 'two ticks');
    assert.equal(of(seen, 'player.join').length, 0, 'baseline must not emit joins');

    s.state.players.push(player('B'));
    await waitFor(() => of(seen, 'player.join').length === 1, 2000, 'join B');
    assert.equal(of(seen, 'player.join')[0]!.player.steamId, 'B');
    await sleep(60);
    assert.equal(of(seen, 'player.join').length, 1, 'join emitted exactly once');

    s.state.players = s.state.players.filter((p) => p.steamId !== 'B');
    await waitFor(() => of(seen, 'player.leave').length === 1, 2000, 'leave B');
    const leaveB = of(seen, 'player.leave')[0]!;
    assert.equal(leaveB.player.steamId, 'B');
    assert.ok(
      typeof leaveB.sessionSeconds === 'number' && leaveB.sessionSeconds >= 0,
      'known session length',
    );

    s.state.players = [];
    await waitFor(() => of(seen, 'player.leave').length === 2, 2000, 'leave A');
    assert.equal(
      of(seen, 'player.leave')[1]!.sessionSeconds,
      null,
      'baseline player has unknown session length',
    );
  } finally {
    await host.stop();
    await s.close();
  }
});

test('host: polls are spaced by pollMs (no tight loop)', async () => {
  const s = await startMockServer();
  const seen: Seen = [];
  const { host } = makeHost(s, recorder(seen, ['tick']), { pollMs: 50 });
  try {
    await host.start();
    await sleep(260);
    const ticks = of(seen, 'tick').length;
    assert.ok(ticks >= 3 && ticks <= 7, `expected ~5 ticks in 260ms at 50ms, got ${ticks}`);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('host: match.map / match.new / match.lighting / score.changed', async () => {
  const s = await startMockServer();
  const seen: Seen = [];
  const { host } = makeHost(
    s,
    recorder(seen, ['tick', 'match.map', 'match.new', 'match.lighting', 'score.changed']),
  );
  try {
    await host.start();
    await waitFor(() => of(seen, 'tick').length >= 1);

    s.state.map = 'Europe';
    await waitFor(() => of(seen, 'match.map').length === 1, 2000, 'map change');
    const mapEv = of(seen, 'match.map')[0]!;
    assert.equal(mapEv.from.map, 'Kavkazi');
    assert.equal(mapEv.to.map, 'Europe');
    assert.equal(of(seen, 'match.new').length, 1, 'a map change is a new match (level load)');

    s.state.matchSeconds = 5;
    await waitFor(() => of(seen, 'match.new').length === 2, 2000, 'match.new on a timer reset');
    s.state.matchSeconds = 50;
    await sleep(60);
    assert.equal(of(seen, 'match.new').length, 2, 'increasing matchSeconds is not a new match');

    s.state.lighting = 'Night';
    await waitFor(() => of(seen, 'match.lighting').length === 1, 2000, 'lighting');
    assert.deepEqual(of(seen, 'match.lighting')[0]!, {
      ...of(seen, 'match.lighting')[0]!,
      from: 'DayClear',
      to: 'Night',
    });

    s.state.factionScores[0]!.score = 120;
    await waitFor(() => of(seen, 'score.changed').length === 1, 2000, 'score');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('host: server.down / server.up with no spurious join/leave across the gap', async () => {
  const s = await startMockServer({ state: { players: [player('A'), player('B')] } });
  const seen: Seen = [];
  const { host } = makeHost(
    s,
    recorder(seen, ['tick', 'server.down', 'server.up', 'player.join', 'player.leave']),
    { timeoutMs: 200 },
  );
  try {
    await host.start();
    await waitFor(() => of(seen, 'tick').length >= 1);
    const port = s.port;
    await s.close();
    await waitFor(() => of(seen, 'server.down').length === 1, 3000, 'server.down');
    await sleep(80);
    assert.equal(of(seen, 'server.down').length, 1, 'server.down emitted once per outage');

    // Come back with a different roster: B left, C joined while we were blind.
    const s2 = await startMockServer({ port, state: { players: [player('A'), player('C')] } });
    try {
      await waitFor(() => of(seen, 'server.up').length === 1, 3000, 'server.up');
      const up = of(seen, 'server.up')[0]!;
      assert.ok(up.downForMs !== null && up.downForMs >= 0);
      await waitFor(() => of(seen, 'tick').length >= 4, 2000, 'ticks after recovery');
      assert.equal(of(seen, 'player.join').length, 0, 'no join for changes during the outage');
      assert.equal(of(seen, 'player.leave').length, 0, 'no leave for changes during the outage');

      // But a change after recovery is diffed normally.
      s2.state.players.push(player('D'));
      await waitFor(() => of(seen, 'player.join').length === 1, 2000, 'join D');
      assert.equal(of(seen, 'player.join')[0]!.player.steamId, 'D');
    } finally {
      await host.stop();
      await s2.close();
    }
  } catch (e) {
    await host.stop();
    throw e;
  }
});

test('host: audit.entry only for new entries, in chronological order', async () => {
  const entry = (t: string, event: string) => ({
    timestampUtc: t,
    peer: 'admin',
    sessionId: 's',
    event,
    detail: event,
  });
  const s = await startMockServer({
    state: { audit: [entry('2026-01-01T00:00:02Z', 'old2'), entry('2026-01-01T00:00:01Z', 'old1')] },
  });
  const seen: Seen = [];
  const { host } = makeHost(s, recorder(seen, ['audit.entry']), { auditPollMs: 25 });
  try {
    await host.start();
    await waitFor(() => s.requests.some((r) => r.path.startsWith('/v1/audit')), 2000, 'first audit poll');
    await sleep(60);
    assert.equal(of(seen, 'audit.entry').length, 0, 'seed fetch emits nothing');

    // Newest-first, as a server might return them.
    s.state.audit.unshift(entry('2026-01-01T00:00:04Z', 'new4'), entry('2026-01-01T00:00:03Z', 'new3'));
    await waitFor(() => of(seen, 'audit.entry').length === 2, 2000, 'two new entries');
    assert.deepEqual(
      of(seen, 'audit.entry').map((e) => e.entry.event),
      ['new3', 'new4'],
    );
    await sleep(60);
    assert.equal(of(seen, 'audit.entry').length, 2, 'no re-emits');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('host: plugin with unmet `requires` is skipped; a throwing handler does not break others', async () => {
  const s = await startMockServer({
    state: { routes: ['GET /v1/status', 'GET /v1/players', 'GET /v1/capabilities'] },
  });
  let gatedSetup = 0;
  const gated = definePlugin({
    name: 'gated',
    description: '',
    requires: [['PATCH', '/v1/players/{id}']],
    setup() {
      gatedSetup++;
    },
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const seen: Seen = [];
  const thrower = definePlugin({
    name: 'thrower',
    description: '',
    setup(ctx) {
      ctx.on('tick', () => {
        throw new Error('boom');
      });
    },
  });
  const rec = recorder(seen, ['tick']);
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: { pollMs: 20, auditPollMs: 1000, dataDir, logLevel: 'error', pluginsFile: 'unused' },
    plugins: {
      gated: { enabled: true },
      thrower: { enabled: true },
      rec: { enabled: true },
      nope: { enabled: true },
    },
    registry: { gated, thrower, rec },
    logger: createLogger('error'),
  });
  try {
    await host.start();
    await waitFor(() => of(seen, 'tick').length >= 2, 2000, 'ticks despite throwing sibling');
    assert.equal(gatedSetup, 0, 'gated plugin never set up');
  } finally {
    await host.stop();
    await s.close();
  }
});
