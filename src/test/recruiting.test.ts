import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { PluginHost } from '../host/host.ts';
import { createLogger } from '../host/logger.ts';
import { RconClient } from '../rcon/client.ts';
import type { AnyPlugin } from '../host/plugin.ts';
import recruitPitch from '../plugins/recruit-pitch.ts';
import regulars, { tierFor } from '../plugins/regulars.ts';
import matchMvp, { rankPlayers } from '../plugins/match-mvp.ts';
import fillServer, { inQuietHours } from '../plugins/fill-server.ts';
import { dueReminders, inWords, nextOccurrence } from '../plugins/event-announcer.ts';
import { player, sleep, startMockServer, TOKEN, waitFor, type MockServer } from './mock-server.ts';

function makeHost(
  s: MockServer,
  plugin: AnyPlugin,
  options: Record<string, unknown>,
  discordWebhookUrl?: string,
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: {
      pollMs: 20,
      auditPollMs: 1000,
      dataDir,
      logLevel: 'error',
      pluginsFile: 'unused',
      outbox: { dmPerMinute: 1_000_000, broadcastPerMinute: 1_000_000, dmGapPerPlayerMs: 0 },
      discordWebhookUrl,
    },
    plugins: { [plugin.name]: { enabled: true, ...options } },
    registry: { [plugin.name]: plugin },
    logger: createLogger('error'),
  });
  return { host, dataDir };
}

/** Minimal webhook sink so Discord-posting plugins can be verified without the network. */
async function webhookSink(): Promise<{ url: string; posts: unknown[]; close(): Promise<void> }> {
  const posts: unknown[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => {
      posts.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    posts,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

test('recruit-pitch: pitches once after the session threshold, never twice inside repeatAfterDays', async () => {
  const s = await startMockServer({ state: { players: [player('a', { name: 'Ann' })] } });
  const { host } = makeHost(s, recruitPitch, {
    afterMinutes: 0,
    repeatAfterDays: 7,
    message: 'Join us, {name} ({kills} kills)',
  });
  try {
    await host.start();
    const dms = () => s.requests.filter((r) => r.path === '/v1/players/a/message');
    await waitFor(() => dms().length === 1, 2000, 'pitch DM');
    assert.deepEqual(JSON.parse(dms()[0]!.body), { message: 'Join us, Ann (0 kills)' });
    await sleep(120);
    assert.equal(dms().length, 1, 'no repeat pitch');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('recruit-pitch: respects minKills', async () => {
  const s = await startMockServer({
    state: { players: [player('a', { kills: 2 }), player('b', { kills: 9 })] },
  });
  const { host } = makeHost(s, recruitPitch, { afterMinutes: 0, minKills: 5 });
  try {
    await host.start();
    await waitFor(() => s.requests.some((r) => r.path === '/v1/players/b/message'), 2000, 'pitch b');
    await sleep(80);
    assert.equal(s.requests.filter((r) => r.path === '/v1/players/a/message').length, 0, 'a below minKills');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('regulars: counts visits, DMs the matching tier, writes the leaderboard', async () => {
  assert.equal(tierFor(3, [{ visits: 3, message: 'x' }])?.message, 'x');
  assert.equal(tierFor(4, [{ visits: 3, message: 'x' }]), undefined);

  const s = await startMockServer();
  const { host, dataDir } = makeHost(s, regulars, {
    delayMs: 10,
    tiers: [{ visits: 2, message: 'Visit {visits}, {name}!' }],
  });
  try {
    await host.start();
    await waitFor(() => s.requests.some((r) => r.path === '/v1/players'));
    s.state.players.push(player('r', { name: 'Rae' }));
    await sleep(80); // visit 1: no tier
    s.state.players = [];
    await sleep(80);
    s.state.players.push(player('r', { name: 'Rae' }));
    const dms = () => s.requests.filter((r) => r.path === '/v1/players/r/message');
    await waitFor(() => dms().length === 1, 2000, 'tier DM on 2nd visit');
    assert.deepEqual(JSON.parse(dms()[0]!.body), { message: 'Visit 2, Rae!' });
    await waitFor(() => fs.existsSync(path.join(dataDir, 'regulars.json')), 2000, 'leaderboard file');
    const board = JSON.parse(fs.readFileSync(path.join(dataDir, 'regulars.json'), 'utf8')) as Array<{
      steamId: string;
      visits: number;
    }>;
    assert.equal(board[0]?.steamId, 'r');
    assert.equal(board[0]?.visits, 2);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('match-mvp: ranks by kills and shouts out the top players when a match ends', () => {
  const ranked = rankPlayers([
    player('c', { name: 'C', kills: 0 }),
    player('a', { name: 'A', kills: 10, deaths: 4 }),
    player('b', { name: 'B', kills: 10, deaths: 2 }),
  ]);
  assert.deepEqual(
    ranked.map((p) => p.name),
    ['B', 'A', 'C'],
  );
});

test('match-mvp: broadcast + MVP DM on match.new', async () => {
  const s = await startMockServer({
    state: {
      players: [
        player('a', { name: 'Ash', kills: 10, deaths: 3 }),
        player('b', { name: 'Bo', kills: 3 }),
        player('c', { name: 'Cy', kills: 0 }),
        player('d', { name: 'Di', kills: 7, deaths: 9 }),
      ],
    },
  });
  const { host } = makeHost(s, matchMvp, {
    top: 3,
    minPlayers: 3,
    broadcast: 'MVPs: {list}',
    mvpMessage: 'GG {name} {kills}K',
  });
  try {
    await host.start();
    await waitFor(() => s.requests.filter((r) => r.path === '/v1/status').length >= 2);
    s.state.matchSeconds = 0; // match ended / restarted
    const bc = () => s.requests.filter((r) => r.path === '/v1/broadcast');
    await waitFor(() => bc().length === 1, 2000, 'mvp broadcast');
    assert.deepEqual(JSON.parse(bc()[0]!.body), {
      message: 'MVPs: 1. Ash 10K/3D · 2. Di 7K/9D · 3. Bo 3K/0D',
    });
    await waitFor(() => s.requests.some((r) => r.path === '/v1/players/a/message'), 2000, 'mvp DM');
    assert.deepEqual(JSON.parse(s.requests.find((r) => r.path === '/v1/players/a/message')!.body), {
      message: 'GG Ash 10K',
    });
  } finally {
    await host.stop();
    await s.close();
  }
});

test('fill-server: quiet-hours logic', () => {
  assert.equal(inQuietHours('02:00', ['01:00', '09:00']), true);
  assert.equal(inQuietHours('09:00', ['01:00', '09:00']), false);
  assert.equal(inQuietHours('23:30', ['22:00', '06:00']), true, 'wraps midnight');
  assert.equal(inQuietHours('05:59', ['22:00', '06:00']), true);
  assert.equal(inQuietHours('12:00', ['22:00', '06:00']), false);
  assert.equal(inQuietHours('12:00', []), false);
});

test('fill-server: posts one rally to Discord when under-populated, then respects the cooldown', async () => {
  const hook = await webhookSink();
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(
    s,
    fillServer,
    {
      belowPlayers: 5,
      cooldownMinutes: 60,
      message: '{players}/{max} on {server}, {free} free',
      connectInfo: 'Search "Mock" in the browser',
      broadcast: 'Invite a friend ({free} free)',
    },
    hook.url,
  );
  try {
    await host.start();
    await waitFor(() => hook.posts.length === 1, 2000, 'rally post');
    assert.deepEqual(hook.posts[0], {
      username: 'WARDOGS',
      content: '1/64 on Mock Server, 63 free\nSearch "Mock" in the browser',
    });
    await waitFor(() => s.requests.some((r) => r.path === '/v1/broadcast'), 2000, 'in-game nudge');
    await sleep(100);
    assert.equal(hook.posts.length, 1, 'cooldown holds');
  } finally {
    await host.stop();
    await s.close();
    await hook.close();
  }
});

test('event-announcer: next occurrence and due reminders', () => {
  const wed = new Date(2026, 8, 16, 19, 0, 0); // Wed 16 Sep 2026 19:00 local
  assert.equal(wed.getDay(), 3);
  const next = nextOccurrence({ day: 'fri', time: '20:00' }, wed)!;
  assert.equal(next.getDay(), 5);
  assert.equal(next.getDate(), 18);
  assert.equal(next.getHours(), 20);

  const daily = nextOccurrence({ day: '*', time: '19:00' }, new Date(2026, 8, 16, 19, 0, 30))!;
  assert.equal(daily.getDate(), 16, 'an event that started 30 s ago still counts as today');
  const tomorrow = nextOccurrence({ day: '*', time: '19:00' }, new Date(2026, 8, 16, 19, 2, 0))!;
  assert.equal(tomorrow.getDate(), 17, 'two minutes past → tomorrow');

  assert.equal(nextOccurrence({ day: 'funday', time: '20:00' }, wed), null);
  assert.equal(nextOccurrence({ day: 'fri', time: '25:00' }, wed), null);

  const ev = { day: 'fri', time: '20:00' };
  assert.deepEqual(
    dueReminders(ev, [60, 15, 0], new Date(2026, 8, 18, 19, 0, 30)).map((d) => d.offset),
    [60],
  );
  assert.deepEqual(
    dueReminders(ev, [60, 15, 0], new Date(2026, 8, 18, 19, 45, 59)).map((d) => d.offset),
    [15],
  );
  assert.deepEqual(
    dueReminders(ev, [60, 15, 0], new Date(2026, 8, 18, 20, 0, 10)).map((d) => d.offset),
    [0],
  );
  assert.deepEqual(dueReminders(ev, [60, 15, 0], new Date(2026, 8, 18, 19, 30, 0)), []);

  assert.equal(inWords(0), 'now');
  assert.equal(inWords(15), 'in 15 minutes');
  assert.equal(inWords(60), 'in 1 hour');
  assert.equal(inWords(120), 'in 2 hours');
});

test('regulars: play time accrues every poll while the player is on, not only when they leave', async () => {
  const s = await startMockServer({ state: { players: [player('r', { name: 'Rae' })] } });
  const { host, dataDir } = makeHost(s, regulars, { tiers: [] });
  try {
    await host.start();
    await waitFor(() => s.requests.filter((r) => r.path === '/v1/players').length >= 2);
    await sleep(300);
  } finally {
    await host.stop(); // flushes the plugin's state
    await s.close();
  }
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state', 'regulars.json'), 'utf8')) as {
    players: Record<string, { visits: number; minutes: number }>;
  };
  assert.equal(state.players.r?.visits, 1, 'already on at the baseline counts as a visit');
  assert.ok((state.players.r?.minutes ?? 0) > 0.003, `minutes accrued while on: ${state.players.r?.minutes}`);
  assert.ok((state.players.r?.minutes ?? 0) < 0.05, 'and not more than the time watched');
});

test('recruit-pitch: a full server is pitched a few per poll, never in one burst', async () => {
  const roster = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => player(id));
  const s = await startMockServer({ state: { players: roster } });
  const { host } = makeHost(s, recruitPitch, { afterMinutes: 0.0005, maxPerTick: 4, message: 'hi {name}' }); // 30 ms
  try {
    await host.start();
    const dms = () => s.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/message'));
    await waitFor(() => dms().length >= 4, 2000, 'first batch');
    assert.equal(dms().length, 4, 'capped per poll');
    await waitFor(() => dms().length === 10, 3000, 'everyone pitched over the next polls');
    await sleep(80);
    assert.equal(dms().length, 10, 'and nobody twice');
  } finally {
    await host.stop();
    await s.close();
  }
});
