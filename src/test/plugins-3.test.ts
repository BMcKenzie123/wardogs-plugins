/** Match/map, stats and ops plugins from docs/SPEC-2.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import rotationScheduler, { activeSchedule } from '../plugins/rotation-scheduler.ts';
import populationMaps from '../plugins/population-maps.ts';
import staleMatch from '../plugins/stale-match.ts';
import weatherRandomizer, { pickWeighted } from '../plugins/weather-randomizer.ts';
import scoreTickTuner from '../plugins/score-tick-tuner.ts';
import sponsorRotator from '../plugins/sponsor-rotator.ts';
import configBackup, { lineDiff } from '../plugins/config-backup.ts';
import weeklyRecap, { recapText } from '../plugins/weekly-recap.ts';
import leaderboard from '../plugins/leaderboard.ts';
import steamProfiles from '../plugins/steam-profiles.ts';
import prometheusMetrics from '../plugins/prometheus-metrics.ts';
import webDashboard from '../plugins/web-dashboard.ts';
import healthEndpoint from '../plugins/health-endpoint.ts';
import downtimeAlert from '../plugins/downtime-alert.ts';
import { hourlyPlayerCounts, readStats, topByKills } from '../host/stats.ts';
import {
  fetchText,
  freePort,
  player,
  sleep,
  startMockServer,
  startSteamMock,
  startWebhookSink,
  waitFor,
} from './mock-server.ts';
import { bodyOf, makeHost, requestsTo, writeStats } from './helpers.ts';

const FRI = (h: number, m = 0) => new Date(2026, 8, 18, h, m, 0); // Fri 18 Sep 2026
const SAT = (h: number, m = 0) => new Date(2026, 8, 19, h, m, 0);

test('rotation-scheduler: activeSchedule handles days, plain windows and midnight wrap', () => {
  assert.equal(FRI(12).getDay(), 5);
  const plain = [{ days: ['fri'], from: '19:00', to: '23:00', entries: [] }];
  assert.equal(activeSchedule(plain, FRI(20)), 0);
  assert.equal(activeSchedule(plain, FRI(18, 59)), -1);
  assert.equal(activeSchedule(plain, SAT(20)), -1);
  const wrap = [{ days: ['Friday'], from: '22:00', to: '02:00', entries: [] }];
  assert.equal(activeSchedule(wrap, FRI(23)), 0, 'evening part on the listed day');
  assert.equal(activeSchedule(wrap, SAT(1)), 0, 'early-morning part the day after');
  assert.equal(activeSchedule(wrap, SAT(23)), -1, 'Saturday evening is not in a Friday window');
  assert.equal(activeSchedule(wrap, FRI(21)), -1);
  assert.equal(activeSchedule([{ days: ['*'], from: '00:00', to: '23:59', entries: [] }], SAT(4)), 0);
});

test('rotation-scheduler: replaces and saves the rotation when a window is active, once', async () => {
  const s = await startMockServer();
  s.state.rotation.entries.push(
    { map: 'A', experiences: [], lighting: '', zoneAlternator: '', status: 'now', denied: false },
    { map: 'B', experiences: [], lighting: '', zoneAlternator: '', status: '', denied: false },
  );
  const { host } = makeHost(s, [rotationScheduler], {
    'rotation-scheduler': {
      checkSeconds: 0.15,
      schedules: [
        { days: ['*'], from: '00:00', to: '23:59', entries: [{ map: 'X' }, { map: 'Y', lighting: 'Night' }] },
      ],
    },
  });
  try {
    await host.start();
    await waitFor(() => s.state.rotationSaved === 1, 2000, 'rotation saved');
    assert.deepEqual(
      s.state.rotation.entries.map((e) => `${e.map}:${e.lighting}`),
      ['X:', 'Y:Night'],
    );
    assert.deepEqual(
      s.requests.filter((r) => r.method === 'DELETE').map((r) => r.path),
      ['/v1/rotation/entries/1', '/v1/rotation/entries/0'],
      'deleted from the end so indexes stay valid',
    );
    await sleep(400);
    assert.equal(s.state.rotationSaved, 1, 'not re-applied while the same window stays active');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('population-maps: after a new match, switches to a map that fits the population', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(s, [populationMaps], {
    'population-maps': {
      tiers: [
        { maxPlayers: 2, maps: ['Small'] },
        { maxPlayers: 999, maps: ['Big'] },
      ],
      graceSeconds: 0.05,
    },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 2);
    s.state.matchSeconds = 0; // new match on Kavkazi
    await waitFor(() => requestsTo(s, 'POST', '/v1/match/map').length === 1, 2000, 'map change');
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/match/map')[0]), { map: 'Small' });
    s.state.matchSeconds = 50;
    await sleep(60);
    s.state.matchSeconds = 0; // next match already on Small
    await sleep(200);
    assert.equal(requestsTo(s, 'POST', '/v1/match/map').length, 1, 'no change when the map already fits');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('stale-match: ends a match that ran too long, once', async () => {
  const s = await startMockServer({ state: { matchSeconds: 5000 } });
  const { host } = makeHost(s, [staleMatch], { 'stale-match': { maxMinutes: 60 } });
  try {
    await host.start();
    await waitFor(() => s.state.matchEnded === 1, 2000, 'match ended');
    s.state.matchSeconds = 10; // new match under way
    await sleep(120);
    assert.equal(s.state.matchEnded, 1);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('weather-randomizer: weighted pick and a fresh lighting on match.new', async () => {
  assert.equal(
    pickWeighted(['a', 'b', 'c'], [1, 0, 1], () => 0.6),
    'c',
  );
  assert.equal(
    pickWeighted(['a', 'b', 'c'], [1, 0, 1], () => 0.1),
    'a',
  );
  assert.equal(
    pickWeighted(['a', 'b', 'c'], [], () => 0.5),
    'b',
  );
  assert.equal(
    pickWeighted([], [], () => 0.5),
    undefined,
  );

  const s = await startMockServer();
  const { host } = makeHost(s, [weatherRandomizer], {
    'weather-randomizer': { lightings: ['DayClear', 'Night'], excludeCurrent: true },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 2);
    s.state.matchSeconds = 0;
    await waitFor(() => requestsTo(s, 'PUT', '/v1/world/lighting').length === 1, 2000, 'lighting set');
    assert.deepEqual(bodyOf(requestsTo(s, 'PUT', '/v1/world/lighting')[0]), { lighting: 'Night' });
  } finally {
    await host.stop();
    await s.close();
  }
});

test('score-tick-tuner: patches the tick for the population, clamped, with cooldown', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(s, [scoreTickTuner], {
    'score-tick-tuner': { table: [{ upToPlayers: 5, scoreTick: 99 }], cooldownSeconds: 60 },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'PATCH', '/v1/settings').length === 1, 2000, 'settings patch');
    assert.deepEqual(
      bodyOf(requestsTo(s, 'PATCH', '/v1/settings')[0]),
      { scoreTick: 30 },
      'clamped to the server max',
    );
    assert.equal(s.state.scoreTick.current, 30);
    await sleep(120);
    assert.equal(requestsTo(s, 'PATCH', '/v1/settings').length, 1);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('sponsor-rotator: cycles through the images', async () => {
  const s = await startMockServer();
  const { host } = makeHost(s, [sponsorRotator], {
    'sponsor-rotator': { imageUrls: ['http://a/1.png', 'http://b/2.png'], everyHours: 0.00005 },
  });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'PUT', '/v1/sponsor').length >= 2, 3000, 'two rotations');
    assert.deepEqual(
      requestsTo(s, 'PUT', '/v1/sponsor')
        .slice(0, 2)
        .map((r) => bodyOf<{ imageUrl: string }>(r).imageUrl),
      ['http://a/1.png', 'http://b/2.png'],
    );
  } finally {
    await host.stop();
    await s.close();
  }
});

test('config-backup: writes a file per revision and reports the diff', async () => {
  assert.deepEqual(lineDiff('a=1\nb=2\n', 'a=1\nb=3\nc=4\n'), { added: ['b=3', 'c=4'], removed: ['b=2'] });

  const s = await startMockServer();
  const { host, dataDir } = makeHost(s, [configBackup], {
    'config-backup': { checkMinutes: 0.003, keep: 10 },
  });
  const dir = path.join(dataDir, 'config');
  try {
    await host.start();
    await waitFor(() => fs.existsSync(dir) && fs.readdirSync(dir).length === 1, 2000, 'first backup');
    s.state.configRevision = 'r2';
    s.state.configText = '[Mock]\nkey=2\nnew=1\n';
    await waitFor(() => fs.readdirSync(dir).length === 2, 2000, 'second backup');
    const files = fs.readdirSync(dir).sort();
    assert.match(files[1]!, /-r2\.ini$/);
    assert.equal(fs.readFileSync(path.join(dir, files[1]!), 'utf8'), '[Mock]\nkey=2\nnew=1\n');
    await sleep(300);
    assert.equal(fs.readdirSync(dir).length, 2, 'unchanged revision is not backed up again');
  } finally {
    await host.stop();
    await s.close();
  }
});

const sessionLine = (
  steamId: string,
  name: string,
  seconds: number,
  kills: number,
  deaths: number,
  t = Date.now(),
) => ({
  t,
  event: 'session',
  steamId,
  name,
  sessionSeconds: seconds,
  kills,
  deaths,
});

test('stats readers: readStats, topByKills aggregates per player, hourlyPlayerCounts', async () => {
  const s = await startMockServer();
  const { dataDir } = makeHost(s, []);
  await s.close();
  const t = Date.now();
  writeStats(dataDir, [
    sessionLine('a', 'Ann', 600, 6, 2, t),
    sessionLine('a', 'Ann', 300, 4, 1, t),
    sessionLine('b', 'Bob', 900, 7, 9, t),
    { t, map: 'Kavkazi', matchSeconds: 10, players: [player('a'), player('b')], factionScores: [] },
    { t, map: 'Kavkazi', matchSeconds: 20, players: [player('a')], factionScores: [] },
  ]);
  const stats = await readStats(dataDir, 0);
  assert.equal(stats.sessions.length, 3);
  assert.equal(stats.snapshots.length, 2);
  const top = topByKills(stats.sessions, 5);
  assert.deepEqual(
    top.map((p) => `${p.name}:${p.kills}:${p.sessions}`),
    ['Ann:10:2', 'Bob:7:1'],
  );
  assert.equal(hourlyPlayerCounts(stats.snapshots)[new Date(t).getHours()], 1.5);
  assert.match(recapText(stats, 5), /1\. Ann 10K\/3D · 2\. Bob 7K\/9D/);
});

test('weekly-recap: posts at the scheduled minute, once', async () => {
  // Avoid the minute rolling over between scheduling and the plugin's check.
  if (new Date().getSeconds() > 55) await sleep(6000);
  const hook = await startWebhookSink();
  const s = await startMockServer();
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { host, dataDir } = makeHost(
    s,
    [weeklyRecap],
    { 'weekly-recap': { day: '*', time, top: 3 } },
    { discordWebhookUrl: hook.url },
  );
  writeStats(dataDir, [sessionLine('a', 'Ann', 600, 6, 2), sessionLine('b', 'Bob', 300, 2, 1)]);
  try {
    await host.start();
    await waitFor(() => hook.posts.length === 1, 3000, 'recap post');
    const content = (hook.posts[0] as { content: string }).content;
    assert.match(content, /Weekly recap/);
    assert.match(content, /1\. Ann 6K\/2D · 2\. Bob 2K\/1D/);
  } finally {
    await host.stop();
    await s.close();
    await hook.close();
  }
});

test('leaderboard: writes data/leaderboard.json sorted by kills', async () => {
  const s = await startMockServer();
  const { host, dataDir } = makeHost(s, [leaderboard], { leaderboard: { everyMinutes: 1, top: 10 } });
  writeStats(dataDir, [sessionLine('a', 'Ann', 600, 2, 2), sessionLine('b', 'Bob', 300, 9, 1)]);
  const file = path.join(dataDir, 'leaderboard.json');
  try {
    await host.start();
    await waitFor(() => fs.existsSync(file), 2000, 'leaderboard file');
    const board = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      rows: Array<{ steamId: string; kills: number }>;
    };
    assert.deepEqual(
      board.rows.map((r) => r.steamId),
      ['b', 'a'],
    );
  } finally {
    await host.stop();
    await s.close();
  }
});

test('steam-profiles: resolves the roster and caches to data/profiles.json', async () => {
  const steam = await startSteamMock({
    summaries: { a: { personaname: 'Ann', avatarfull: 'http://av/a.jpg', loccountrycode: 'US' } },
  });
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host, dataDir } = makeHost(
    s,
    [steamProfiles],
    { 'steam-profiles': { steamBaseUrl: steam.baseUrl } },
    { steamApiKey: 'k' },
  );
  const file = path.join(dataDir, 'profiles.json');
  try {
    await host.start();
    await waitFor(() => fs.existsSync(file), 2000, 'profiles file');
    const profiles = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      { name: string; country: string | null }
    >;
    assert.equal(profiles.a?.name, 'Ann');
    assert.equal(profiles.a?.country, 'US');
    await sleep(80);
    assert.equal(steam.requests.length, 1, 'cached after the first lookup');
  } finally {
    await host.stop();
    await s.close();
    await steam.close();
  }
});

test('http plugins: metrics, health and dashboard share one listener that closes on stop', async () => {
  const port = await freePort();
  const s = await startMockServer({ state: { players: [player('a', { name: 'Ann', pingMs: 50 })] } });
  s.state.factionScores[0]!.score = 120;
  const { host, dataDir } = makeHost(
    s,
    [prometheusMetrics, healthEndpoint, webDashboard],
    {},
    { httpPort: port },
  );
  writeStats(dataDir, [sessionLine('a', 'Ann', 600, 6, 2)]);
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);

    const metrics = await fetchText(`http://127.0.0.1:${port}/metrics`);
    assert.equal(metrics.status, 200);
    assert.match(metrics.body, /^wardogs_up 1$/m);
    assert.match(metrics.body, /^wardogs_players 1$/m);
    assert.match(metrics.body, /^wardogs_faction_score\{faction="Red"\} 120$/m);
    assert.match(metrics.body, /^wardogs_ping_ms_max 50$/m);

    const health = await fetchText(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((JSON.parse(health.body) as { ok: boolean }).ok, true);

    const page = await fetchText(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(page.body, /<h1>Mock Server/);
    assert.match(page.body, /<td>Ann<\/td>/);
    assert.match(page.body, /Average players by hour/);

    const missing = await fetchText(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);

    await s.close();
    let down = await fetchText(`http://127.0.0.1:${port}/healthz`);
    for (let i = 0; i < 100 && down.status !== 503; i += 1) {
      await sleep(20);
      down = await fetchText(`http://127.0.0.1:${port}/healthz`);
    }
    assert.equal(down.status, 503);
    assert.equal((JSON.parse(down.body) as { status: string }).status, 'down');
  } finally {
    await host.stop();
    await s.close().catch(() => undefined);
  }
  await assert.rejects(() => fetchText(`http://127.0.0.1:${port}/healthz`), 'listener released on stop');
});

test('downtime-alert: alerts only after the grace period, then posts a recovery note', async () => {
  const hook = await startWebhookSink();
  const s = await startMockServer();
  const port = s.port;
  const { host } = makeHost(
    s,
    [downtimeAlert],
    { 'downtime-alert': { afterMinutes: 0.002 } },
    { discordWebhookUrl: hook.url },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    await s.close();
    await waitFor(() => hook.posts.length === 1, 3000, 'downtime post');
    assert.match((hook.posts[0] as { content: string }).content, /unreachable/);
    const s2 = await startMockServer({ port });
    try {
      await waitFor(() => hook.posts.length === 2, 3000, 'recovery post');
      assert.match((hook.posts[1] as { content: string }).content, /back after/);
    } finally {
      await host.stop();
      await s2.close();
    }
  } catch (e) {
    await host.stop();
    throw e;
  } finally {
    await hook.close();
  }
});
