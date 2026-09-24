/** Steam identities in the panel (with STEAM_API_KEY) and the live-update section markers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import adminPanel from '../plugins/admin-panel.ts';
import { freePort, httpRequest, player, startMockServer, startSteamMock, waitFor } from './mock-server.ts';
import { makeHost, requestsTo } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };
const BANNED = '76561198000000001';
const RESERVED = '76561198000000002';

test('admin-panel: shows Steam names and avatars for players, bans and reserved slots when a key is set', async () => {
  const port = await freePort();
  const steam = await startSteamMock({
    summaries: {
      a: { personaname: 'Pa on Steam', avatarfull: 'https://avatars.example/a.jpg' },
      [BANNED]: { personaname: 'Ralf', avatarfull: 'https://avatars.example/ralf.jpg' },
      [RESERVED]: { personaname: 'JDAM', avatarfull: 'https://avatars.example/jdam.jpg' },
    },
  });
  const s = await startMockServer({
    state: {
      players: [player('a')],
      bans: [{ steamId: BANNED, bannedAtUtc: '2026-09-20T10:00:00Z', bannedBy: 'bqmck', reason: 'cheating' }],
      reservedSlots: [RESERVED],
    },
  });
  const { host } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/admin', steamBaseUrl: steam.baseUrl, steamTimeoutMs: 10000 } },
    { httpPort: port, adminPassword: 'hunter2hunter2', steamApiKey: 'test-key' },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    const page = await httpRequest(`http://127.0.0.1:${port}/admin`, { headers: AUTH });
    assert.equal(page.status, 200);
    // player row: avatar, in-game name, and the Steam persona when it differs
    assert.match(page.body, /<img class="av" src="https:\/\/avatars\.example\/a\.jpg"[^>]*><b>Pa<\/b>/);
    assert.match(page.body, /Steam: Pa on Steam/);
    // bans and reserved slots: persona name with the id kept as a tag
    assert.match(
      page.body,
      /<img class="av" src="https:\/\/avatars\.example\/ralf\.jpg"[^>]*><b>Ralf<\/b><br><span class="tag">76561198000000001<\/span>/,
    );
    assert.match(page.body, /<b>JDAM<\/b><br><span class="tag">76561198000000002<\/span>/);
    assert.match(page.body, /Steam names on/);
    assert.equal(steam.requests.length, 1, 'one batched lookup for every id on the page');
    await httpRequest(`http://127.0.0.1:${port}/admin`, { headers: AUTH });
    assert.equal(steam.requests.length, 1, 'second page load served from the cache');
    // live-update markers wrap every section that changes on its own
    for (const id of ['status', 'players', 'automation', 'activity', 'lists', 'audit', 'stats', 'hourly'])
      assert.match(page.body, new RegExp(`data-live="${id}"`), `section ${id}`);
  } finally {
    await host.stop();
    await s.close();
    await steam.close();
  }
});

test('admin-panel: without a key the ids are shown plain and Steam is never called', async () => {
  const port = await freePort();
  const s = await startMockServer({
    state: {
      players: [player('a')],
      bans: [{ steamId: BANNED, bannedAtUtc: '2026-09-20T10:00:00Z', bannedBy: 'bqmck', reason: 'x' }],
    },
  });
  const { host } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/admin' } },
    { httpPort: port, adminPassword: 'hunter2hunter2' },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    const page = await httpRequest(`http://127.0.0.1:${port}/admin`, { headers: AUTH });
    assert.doesNotMatch(page.body, /class="av"/);
    assert.match(page.body, /<span class="tag">76561198000000001<\/span>/);
    assert.match(page.body, /Steam names off \(set STEAM_API_KEY\)/);
  } finally {
    await host.stop();
    await s.close();
  }
});
