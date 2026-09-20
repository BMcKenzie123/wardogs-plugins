/** Sessions survive a host restart; observed time is credited when the true join is unknown. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { definePlugin } from '../host/plugin.ts';
import { RconClient } from '../rcon/client.ts';
import type { Events } from '../host/events.ts';
import { player, sleep, startMockServer, TOKEN, waitFor } from './mock-server.ts';
import { makeHost } from './helpers.ts';

const leaves: Array<Events['player.leave']> = [];
const recorder = definePlugin({
  name: 'rec',
  description: '',
  setup(ctx) {
    ctx.on('player.leave', (e) => {
      leaves.push(e);
    });
  },
});

test('host: a player who joined before a restart keeps their session across it', async () => {
  leaves.length = 0;
  const s = await startMockServer({ state: { players: [player('a')] } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  try {
    const first = makeHost(s, [recorder], {}, { dataDir }).host;
    await first.start();
    await sleep(60);
    s.state.players.push(player('b')); // b joins while the first host watches: exact start known
    await sleep(120);
    const joinedB = Date.now();
    await first.stop();
    assert.ok(fs.existsSync(path.join(dataDir, 'sessions.json')), 'roster checkpointed');

    await sleep(100);
    const second = makeHost(s, [recorder], {}, { dataDir }).host;
    await second.start();
    await sleep(60);
    s.state.players = s.state.players.filter((p) => p.steamId !== 'b');
    await waitFor(() => leaves.length === 1, 2000, 'leave b');
    const b = leaves[0]!;
    assert.equal(b.player.steamId, 'b');
    assert.ok(b.sessionSeconds !== null, 'join time restored from the checkpoint');
    assert.ok(b.sessionSeconds! >= 0.15, `session spans the restart (${b.sessionSeconds}s)`);
    assert.ok(Math.abs(b.observedSeconds - b.sessionSeconds!) < 0.05, 'observed = exact when known');

    // a was already on when the first host started: exact start unknown, but observed since then.
    s.state.players = [];
    await waitFor(() => leaves.length === 2, 2000, 'leave a');
    const a = leaves[1]!;
    assert.equal(a.sessionSeconds, null);
    assert.ok(a.observedSeconds >= (Date.now() - joinedB) / 1000, 'observed time carried across the restart');
    await second.stop();
  } finally {
    await s.close();
  }
});

test('host: a stale checkpoint is ignored; observed time starts at the new baseline', async () => {
  leaves.length = 0;
  const s = await startMockServer({ state: { players: [player('a')] } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  fs.writeFileSync(
    path.join(dataDir, 'sessions.json'),
    JSON.stringify({
      at: Date.now() - 20 * 60_000,
      players: { a: { joinedAt: Date.now() - 3 * 3_600_000, firstSeenAt: 1 } },
    }),
  );
  const host = makeHost(s, [recorder], {}, { dataDir }).host;
  try {
    await host.start();
    await sleep(80);
    s.state.players = [];
    await waitFor(() => leaves.length === 1, 2000, 'leave a');
    assert.equal(leaves[0]!.sessionSeconds, null, '20-minute-old roster says nothing about now');
    assert.ok(leaves[0]!.observedSeconds < 5, 'observed only since this baseline');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('client: every request goes over one keep-alive socket (one source port for the game server)', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const client = new RconClient({
    host: '127.0.0.1',
    port: s.port,
    scheme: 'http',
    password: TOKEN,
    tlsInsecure: false,
    timeoutMs: 1000,
  });
  try {
    await Promise.all([
      client.status(),
      client.players(),
      client.status(),
      client.players(),
      client.audit(5),
    ]);
    await client.status();
    const ports = new Set(s.requests.map((r) => r.port));
    assert.equal(s.requests.length, 6);
    assert.equal(ports.size, 1, `expected one source port, saw ${[...ports].join(', ')}`);
  } finally {
    client.close();
    await s.close();
  }
});
