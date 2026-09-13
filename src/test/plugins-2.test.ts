/** Recruiting/retention and moderation plugins from docs/SPEC-2.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import reservedSlotReward from '../plugins/reserved-slot-reward.ts';
import comeback from '../plugins/comeback.ts';
import killStreak from '../plugins/kill-streak.ts';
import firstTimer from '../plugins/first-timer.ts';
import playtimeRanks from '../plugins/playtime-ranks.ts';
import discordAnnounceBridge from '../plugins/discord-announce-bridge.ts';
import primeTime from '../plugins/prime-time.ts';
import nameFilter from '../plugins/name-filter.ts';
import afkKick from '../plugins/afk-kick.ts';
import tempBans from '../plugins/temp-bans.ts';
import vacCheck from '../plugins/vac-check.ts';
import newAccountGate from '../plugins/new-account-gate.ts';
import adminAlerts from '../plugins/admin-alerts.ts';
import { parseDuration } from '../cli.ts';
import {
  player,
  sleep,
  startDiscordMock,
  startMockServer,
  startSteamMock,
  startWebhookSink,
  waitFor,
} from './mock-server.ts';
import { bodyOf, makeHost, requestsTo, seedState } from './helpers.ts';

test('reserved-slot-reward: grants once at N visits and DMs', async () => {
  const s = await startMockServer();
  const { host } = makeHost(s, [reservedSlotReward], {
    'reserved-slot-reward': { visits: 2, message: 'Slot for {name}' },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    s.state.players.push(player('a', { name: 'Al' }));
    await sleep(80);
    s.state.players = [];
    await sleep(80);
    s.state.players.push(player('a', { name: 'Al' }));
    await waitFor(() => requestsTo(s, 'POST', '/v1/reserved-slots').length === 1, 2000, 'slot grant');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/reserved-slots')[0]), { steamId: 'a' });
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/a/message').length === 1, 2000, 'DM');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/a/message')[0]), { message: 'Slot for Al' });
    s.state.players = [];
    await sleep(80);
    s.state.players.push(player('a', { name: 'Al' }));
    await sleep(120);
    assert.equal(requestsTo(s, 'POST', '/v1/reserved-slots').length, 1, 'never granted twice');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('comeback: DMs a player last seen 20 days ago, ignores a first-timer', async () => {
  const s = await startMockServer();
  const { host, dataDir } = makeHost(s, [comeback], {
    comeback: { awayDays: 14, delayMs: 10, message: 'WB {name} {days}' },
  });
  seedState(dataDir, 'comeback', { lastSeen: { a: Date.now() - 20 * 86_400_000 } });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    s.state.players.push(player('a', { name: 'Al' }), player('b', { name: 'Bo' }));
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/a/message').length === 1, 2000, 'comeback DM');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/a/message')[0]), { message: 'WB Al 20' });
    await sleep(80);
    assert.equal(
      requestsTo(s, 'POST', '/v1/players/b/message').length,
      0,
      'unknown player is not "returning"',
    );
  } finally {
    await host.stop();
    await s.close();
  }
});

test('kill-streak: broadcasts once per threshold per match', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(s, [killStreak], {
    'kill-streak': { thresholds: [3], message: '{name} x{kills}' },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 2);
    s.state.players[0]!.kills = 3;
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length === 1, 2000, 'streak broadcast');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/broadcast')[0]), { message: 'Pa x3' });
    s.state.players[0]!.kills = 5;
    await sleep(100);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, 1, 'threshold fires once');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('first-timer: one public welcome per new steamId', async () => {
  const s = await startMockServer();
  const { host } = makeHost(s, [firstTimer], { 'first-timer': { message: 'welcome {name} to {server}' } });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    s.state.players.push(player('a'));
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length === 1, 2000, 'broadcast');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/broadcast')[0]), {
      message: 'welcome Pa to Mock Server',
    });
    s.state.players = [];
    await sleep(80);
    s.state.players.push(player('a'));
    await sleep(100);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, 1);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('playtime-ranks: announces a rank once the accumulated time crosses it', async () => {
  const s = await startMockServer();
  const { host } = makeHost(s, [playtimeRanks], {
    'playtime-ranks': { ranks: [{ hours: 0.00001, title: 'Regular' }], announce: '{name} is now {title}' },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    s.state.players.push(player('a'));
    await sleep(120);
    s.state.players = [];
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length === 1, 2000, 'rank-up');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/broadcast')[0]), { message: 'Pa is now Regular' });
    s.state.players.push(player('a'));
    await sleep(100);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, 1, 'not announced again');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('discord-announce-bridge: seeds on first fetch, then broadcasts new human messages', async () => {
  const discord = await startDiscordMock([{ id: '100', content: 'old news', author: { username: 'x' } }]);
  const s = await startMockServer();
  const { host } = makeHost(s, [discordAnnounceBridge], {
    'discord-announce-bridge': {
      channelId: 'c1',
      botToken: 'tok',
      intervalSeconds: 0.15,
      baseUrl: discord.baseUrl,
      prefix: '[D] ',
    },
  });
  try {
    await host.start();
    await waitFor(() => discord.requests.length >= 1, 2000, 'seed fetch');
    assert.equal(discord.requests[0]!.headers.authorization, 'Bot tok');
    discord.messages.push(
      { id: '101', content: 'hello all', author: { username: 'ann' } },
      { id: '102', content: 'beep', author: { username: 'bot', bot: true } },
    );
    await waitFor(() => requestsTo(s, 'POST', '/v1/broadcast').length === 1, 2000, 'bridged broadcast');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/broadcast')[0]), { message: '[D] ann: hello all' });
    await sleep(400);
    assert.equal(
      requestsTo(s, 'POST', '/v1/broadcast').length,
      1,
      'old and bot messages skipped, nothing re-sent',
    );
  } finally {
    await host.stop();
    await s.close();
    await discord.close();
  }
});

test('prime-time: posts once when the population crosses the line, then respects the cooldown', async () => {
  const hook = await startWebhookSink();
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(
    s,
    [primeTime],
    { 'prime-time': { atPlayers: 2, message: '{players}/{max} on {map}' } },
    { discordWebhookUrl: hook.url },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/players').length >= 1);
    s.state.players.push(player('b'));
    await waitFor(() => hook.posts.length === 1, 2000, 'prime-time post');
    assert.equal((hook.posts[0] as { content: string }).content, '2/64 on Kavkazi');
    s.state.players.pop();
    await sleep(60);
    s.state.players.push(player('b'));
    await sleep(100);
    assert.equal(hook.posts.length, 1, 'cooldown');
  } finally {
    await host.stop();
    await s.close();
    await hook.close();
  }
});

test('name-filter: DMs then kicks a matching name, leaves others alone', async () => {
  const s = await startMockServer({
    state: { players: [player('bad', { name: 'BadGuy' }), player('ok', { name: 'Fine' })] },
  });
  const { host } = makeHost(s, [nameFilter], {
    'name-filter': { patterns: ['(?i)^bad'], kickReason: 'nope', dmBeforeKick: 'rename' },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/bad/kick').length === 1, 2000, 'kick');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/bad/message')[0]), { message: 'rename' });
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/bad/kick')[0]), { reason: 'nope' });
    await sleep(60);
    assert.equal(s.requests.filter((r) => r.path.startsWith('/v1/players/ok/')).length, 0);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('afk-kick: warns then kicks an idle player; an active player is untouched', async () => {
  const s = await startMockServer({ state: { players: [player('idle'), player('active')] } });
  const { host } = makeHost(s, [afkKick], {
    'afk-kick': {
      afterMinutes: 0.004,
      warnMinutesBefore: 0.002,
      onlyWhenAbove: 0,
      exemptReserved: false,
      kickReason: 'afk {minutes}',
    },
  });
  const ticker = setInterval(() => {
    const active = s.state.players.find((p) => p.steamId === 'active');
    if (active) active.kills += 1;
  }, 25);
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/idle/kick').length === 1, 3000, 'afk kick');
    assert.equal(requestsTo(s, 'POST', '/v1/players/idle/message').length, 1, 'warned first');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/idle/kick')[0]), { reason: 'afk 0.004' });
    assert.equal(
      s.requests.filter((r) => r.path.startsWith('/v1/players/active/')).length,
      0,
      'active player untouched',
    );
  } finally {
    clearInterval(ticker);
    await host.stop();
    await s.close();
  }
});

test('temp-bans: lifts expired bans from the CLI file and keeps the rest', async () => {
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('3d'), 3 * 86_400_000);
  assert.throws(() => parseDuration('soon'));

  const s = await startMockServer();
  s.state.bans.push(
    { steamId: 'x', bannedAtUtc: '', bannedBy: 'wd', reason: 'r' },
    { steamId: 'y', bannedAtUtc: '', bannedBy: 'wd', reason: 'r' },
  );
  const { host, dataDir } = makeHost(s, [tempBans], { 'temp-bans': { checkSeconds: 1 } });
  const file = path.join(dataDir, 'temp-bans.json');
  fs.writeFileSync(
    file,
    JSON.stringify([
      { steamId: 'x', reason: 'r', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { steamId: 'y', reason: 'r', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    ]),
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'DELETE', '/v1/bans/x').length === 1, 2000, 'expired unban');
    await sleep(50);
    assert.equal(requestsTo(s, 'DELETE', '/v1/bans/y').length, 0, 'future ban kept');
    assert.deepEqual(
      s.state.bans.map((b) => b.steamId),
      ['y'],
    );
    const left = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ steamId: string }>;
    assert.deepEqual(
      left.map((b) => b.steamId),
      ['y'],
    );
  } finally {
    await host.stop();
    await s.close();
  }
});

test('vac-check: batches one Steam call for the roster and kicks only banned accounts', async () => {
  const steam = await startSteamMock({
    bans: {
      v: { VACBanned: true, NumberOfVACBans: 1, NumberOfGameBans: 0, DaysSinceLastBan: 10 },
      c: { VACBanned: false, NumberOfGameBans: 0 },
    },
  });
  const s = await startMockServer({ state: { players: [player('v'), player('c')] } });
  const { host } = makeHost(
    s,
    [vacCheck],
    { 'vac-check': { action: 'kick', steamBaseUrl: steam.baseUrl } },
    { steamApiKey: 'k' },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/v/kick').length === 1, 2000, 'kick banned');
    await sleep(80);
    assert.equal(requestsTo(s, 'POST', '/v1/players/c/kick').length, 0, 'clean account stays');
    assert.equal(steam.requests.length, 1, 'one batched call, then cached');
    assert.match(steam.requests[0]!, /steamids=v%2Cc|steamids=c%2Cv/);
  } finally {
    await host.stop();
    await s.close();
    await steam.close();
  }
});

test('new-account-gate: kicks young accounts, keeps old and private ones unless kickUnknown', async () => {
  const now = Math.floor(Date.now() / 1000);
  const steam = await startSteamMock({
    summaries: {
      young: { timecreated: now - 5 * 86_400 },
      old: { timecreated: now - 400 * 86_400 },
      priv: {},
    },
  });
  const s = await startMockServer({ state: { players: [player('young'), player('old'), player('priv')] } });
  const { host } = makeHost(
    s,
    [newAccountGate],
    { 'new-account-gate': { minAccountDays: 30, action: 'kick', steamBaseUrl: steam.baseUrl } },
    { steamApiKey: 'k' },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'POST', '/v1/players/young/kick').length === 1, 2000, 'kick young');
    await sleep(80);
    assert.equal(requestsTo(s, 'POST', '/v1/players/old/kick').length, 0);
    assert.equal(
      requestsTo(s, 'POST', '/v1/players/priv/kick').length,
      0,
      'private profile spared by default',
    );
  } finally {
    await host.stop();
    await s.close();
    await steam.close();
  }
});

test('admin-alerts: relays matching audit events to Discord', async () => {
  const hook = await startWebhookSink();
  const entry = (event: string, detail: string) => ({
    timestampUtc: new Date().toISOString(),
    peer: '10.0.0.9',
    sessionId: 's',
    event,
    detail,
  });
  const s = await startMockServer({ state: { audit: [entry('login', 'seed')] } });
  const { host } = makeHost(
    s,
    [adminAlerts],
    { 'admin-alerts': { events: ['kick', 'ban'] } },
    { discordWebhookUrl: hook.url },
  );
  try {
    await host.start();
    await waitFor(() => s.requests.some((r) => r.path.startsWith('/v1/audit')), 2000, 'audit seed');
    await sleep(60);
    s.state.audit.unshift(entry('login', 'someone logged in'), entry('Kick', 'kicked Bo: afk'));
    await waitFor(() => hook.posts.length === 1, 2000, 'alert post');
    assert.equal((hook.posts[0] as { content: string }).content, '**Kick** by 10.0.0.9: kicked Bo: afk');
    await sleep(80);
    assert.equal(hook.posts.length, 1, 'non-matching events ignored');
  } finally {
    await host.stop();
    await s.close();
    await hook.close();
  }
});
