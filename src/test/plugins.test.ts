import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginHost } from '../host/host.ts';
import { createLogger } from '../host/logger.ts';
import { fill } from '../host/template.ts';
import { RconClient } from '../rcon/client.ts';
import type { Plugin } from '../host/plugin.ts';
import welcome from '../plugins/welcome.ts';
import pingGuard from '../plugins/ping-guard.ts';
import teamBalance from '../plugins/team-balance.ts';
import { scoreboard } from '../plugins/discord-relay.ts';
import { player, sleep, startMockServer, TOKEN, waitFor, type MockServer } from './mock-server.ts';

function makeHost(s: MockServer, plugin: Plugin, options: Record<string, unknown>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  return new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: { pollMs: 20, auditPollMs: 1000, dataDir, logLevel: 'error', pluginsFile: 'unused' },
    plugins: { [plugin.name]: { enabled: true, ...options } },
    registry: { [plugin.name]: plugin as Plugin },
    logger: createLogger('error'),
  });
}

test('template: fills known keys and leaves unknown placeholders intact', () => {
  assert.equal(
    fill('Hi {name}, {players}/{max} on {server}', { name: 'A', players: 3, max: 64, server: 'S' }),
    'Hi A, 3/64 on S',
  );
  assert.equal(fill('{unknown} stays', {}), '{unknown} stays');
});

test('discord-relay: scoreboard picks up a numeric score field when present', () => {
  const snapshot = {
    at: 0,
    players: [],
    status: {
      serverName: 's',
      map: 'm',
      experiences: [],
      lighting: '',
      alternator: '',
      scoreTick: { current: 0, min: 0, max: 0 },
      scoreCap: 0,
      matchSeconds: 0,
      players: { current: 0, max: 0 },
      rotation: null,
      factionScores: [
        { name: 'Red', colorHex: '#f00', score: 12 },
        { name: 'Blue', colorHex: '#00f' },
      ],
    },
  };
  assert.equal(scoreboard(snapshot), 'Red: 12 · Blue');
});

test('welcome: DMs a joining player with the filled template, and a returning player differently', async () => {
  const s = await startMockServer();
  const host = makeHost(s, welcome, {
    delayMs: 10,
    message: 'Hi {name} ({players}/{max}) on {server}',
    returningMessage: 'WB {name}',
  });
  try {
    await host.start();
    await waitFor(() => s.requests.some((r) => r.path === '/v1/players'));
    s.state.players.push(player('42', { name: 'Zed' }));
    const dm = () => s.requests.filter((r) => r.method === 'POST' && r.path === '/v1/players/42/message');
    await waitFor(() => dm().length === 1, 2000, 'welcome DM');
    assert.deepEqual(JSON.parse(dm()[0]!.body), { message: 'Hi Zed (1/64) on Mock Server' });

    s.state.players = [];
    await sleep(80);
    s.state.players.push(player('42', { name: 'Zed' }));
    await waitFor(() => dm().length === 2, 2000, 'returning DM');
    assert.deepEqual(JSON.parse(dm()[1]!.body), { message: 'WB Zed' });
  } finally {
    await host.stop();
    await s.close();
  }
});

test('welcome: no DM if the player left before the delay elapsed', async () => {
  const s = await startMockServer();
  const host = makeHost(s, welcome, { delayMs: 150, message: 'Hi' });
  try {
    await host.start();
    await waitFor(() => s.requests.some((r) => r.path === '/v1/players'));
    s.state.players.push(player('9'));
    await sleep(50);
    s.state.players = [];
    await sleep(200);
    assert.equal(s.requests.filter((r) => r.path === '/v1/players/9/message').length, 0);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('ping-guard: warns after N strikes, kicks after M, and exempts listed ids', async () => {
  const s = await startMockServer({
    state: {
      players: [player('hi', { pingMs: 900 }), player('ok', { pingMs: 30 }), player('vip', { pingMs: 900 })],
    },
  });
  const host = makeHost(s, pingGuard, {
    maxPingMs: 250,
    warnAfterPolls: 2,
    kickAfterPolls: 4,
    exemptReserved: false,
    exemptSteamIds: ['vip'],
    kickReason: 'limit {maxPingMs}',
  });
  try {
    await host.start();
    const msgs = () => s.requests.filter((r) => r.path === '/v1/players/hi/message');
    const kicks = () => s.requests.filter((r) => r.path === '/v1/players/hi/kick');
    await waitFor(() => msgs().length === 1, 2000, 'warning DM');
    assert.equal(kicks().length, 0, 'not kicked yet at warn threshold');
    await waitFor(() => kicks().length === 1, 2000, 'kick');
    assert.deepEqual(JSON.parse(kicks()[0]!.body), { reason: 'limit 250' });
    assert.equal(msgs().length, 1, 'warned exactly once');
    await sleep(100);
    assert.equal(
      s.requests.filter((r) => r.path.startsWith('/v1/players/vip/')).length,
      0,
      'exempt id untouched',
    );
    assert.equal(
      s.requests.filter((r) => r.path.startsWith('/v1/players/ok/')).length,
      0,
      'low-ping player untouched',
    );
  } finally {
    await host.stop();
    await s.close();
  }
});

test('team-balance: skipped without the PATCH route; warns and moves the newest player with autoMove', async () => {
  // Without the route: no broadcast ever.
  const s1 = await startMockServer({
    state: {
      routes: ['GET /v1/status', 'GET /v1/players', 'GET /v1/capabilities'],
      players: [player('1'), player('2'), player('3'), player('4', { faction: 'Blue' })],
    },
  });
  const h1 = makeHost(s1, teamBalance, { threshold: 2, autoMove: true, cooldownSeconds: 0 });
  try {
    await h1.start();
    await sleep(120);
    assert.equal(s1.requests.filter((r) => r.path === '/v1/broadcast').length, 0);
  } finally {
    await h1.stop();
    await s1.close();
  }

  // With the route: 3 Red vs 1 Blue, threshold 2 → warn + move the most recently joined Red.
  const s2 = await startMockServer({
    state: { players: [player('1'), player('2'), player('4', { faction: 'Blue' })] },
  });
  const h2 = makeHost(s2, teamBalance, {
    threshold: 2,
    autoMove: true,
    cooldownSeconds: 60,
    warnMessage: '{a} vs {b}',
  });
  try {
    await h2.start();
    await waitFor(() => s2.requests.some((r) => r.path === '/v1/players'));
    await sleep(60);
    s2.state.players.push(player('3', { kills: 99 })); // newest, even though most kills
    const bc = () => s2.requests.filter((r) => r.path === '/v1/broadcast');
    await waitFor(() => bc().length === 1, 2000, 'warn broadcast');
    assert.deepEqual(JSON.parse(bc()[0]!.body), { message: 'Red 3 vs Blue 1' });
    await waitFor(
      () => s2.requests.some((r) => r.method === 'PATCH' && r.path === '/v1/players/3'),
      2000,
      'move newest',
    );
    assert.deepEqual(JSON.parse(s2.requests.find((r) => r.method === 'PATCH')!.body), { faction: 'Blue' });
    await sleep(100);
    assert.equal(bc().length, 1, 'cooldown prevents repeat warnings');
  } finally {
    await h2.stop();
    await s2.close();
  }
});
