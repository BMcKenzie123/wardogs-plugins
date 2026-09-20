import test from 'node:test';
import assert from 'node:assert/strict';
import adminPanel, { namesFrom } from '../plugins/admin-panel.ts';
import { freePort, httpRequest, player, startMockServer, waitFor } from './mock-server.ts';
import { bodyOf, makeHost, requestsTo } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('anyone:hunter2hunter2').toString('base64')}` };

test('admin-panel: namesFrom copes with the loose catalog shapes', () => {
  assert.deepEqual(namesFrom(['Kavkazi', 'Europe']), ['Kavkazi', 'Europe']);
  assert.deepEqual(namesFrom({ maps: [{ id: 'Kavkazi', name: 'Kavkazi' }, { name: 'Ozeti' }] }), [
    'Kavkazi',
    'Ozeti',
  ]);
  assert.deepEqual(namesFrom('nope'), []);
});

test('admin-panel: auth, csrf, and actions reach the RCON API', async () => {
  const port = await freePort();
  const s = await startMockServer({
    state: { players: [player('a', { name: 'Ann' }), player('b', { name: 'Bo' })] },
  });
  const { host } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/admin' } },
    { httpPort: port, adminPassword: 'hunter2hunter2' },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);

    const anon = await httpRequest(`${base}/admin`);
    assert.equal(anon.status, 401);
    assert.match(String(anon.headers['www-authenticate']), /Basic/);

    const wrong = await httpRequest(`${base}/admin`, {
      headers: { Authorization: `Basic ${Buffer.from('x:wrong').toString('base64')}` },
    });
    assert.equal(wrong.status, 401);

    const page = await httpRequest(`${base}/admin`, { headers: AUTH });
    assert.equal(page.status, 200);
    assert.match(page.body, /<b>Ann<\/b>/);
    assert.match(page.body, /Broadcast/);
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(page.body)?.[1];
    assert.ok(csrf, 'csrf token rendered');

    const post = (fields: Record<string, string>, headers: Record<string, string> = AUTH) =>
      httpRequest(`${base}/admin/action`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: `http://127.0.0.1:${port}`,
        },
        body: new URLSearchParams(fields).toString(),
      });

    const noCsrf = await post({ action: 'kick', steamId: 'a' });
    assert.equal(noCsrf.status, 403);
    assert.equal(requestsTo(s, 'POST', '/v1/players/a/kick').length, 0);

    const noAuth = await post({ action: 'kick', steamId: 'a', _csrf: csrf! }, {});
    assert.equal(noAuth.status, 401);

    const kick = await post({ action: 'kick', steamId: 'a', text: 'bye', _csrf: csrf! });
    assert.equal(kick.status, 303);
    assert.match(String(kick.headers.location), /^\/admin\?msg=Kicked/);
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/a/kick')[0]), { reason: 'bye' });

    const bc = await post({ action: 'broadcast', text: 'hello all', _csrf: csrf! });
    assert.equal(bc.status, 303);
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/broadcast')[0]), { message: 'hello all' });

    const map = await post({
      action: 'map',
      map: 'Europe',
      experiences: 'A+B',
      lighting: 'Night',
      _csrf: csrf!,
    });
    assert.equal(map.status, 303);
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/match/map')[0]), {
      map: 'Europe',
      experiences: ['A', 'B'],
      lighting: 'Night',
    });

    const badSponsor = await post({ action: 'sponsor', imageUrl: 'https://imgur.com/x.png', _csrf: csrf! });
    assert.match(
      decodeURIComponent(String(badSponsor.headers.location)),
      /not on the server's image whitelist/,
    );
    assert.equal(requestsTo(s, 'PUT', '/v1/sponsor').length, 0);

    const move = await post({ action: 'faction', steamId: 'b', faction: 'Blue', _csrf: csrf! });
    assert.equal(move.status, 303);
    assert.deepEqual(bodyOf(requestsTo(s, 'PATCH', '/v1/players/b')[0]), { faction: 'Blue' });
  } finally {
    await host.stop();
    await s.close();
  }
});

test('admin-panel: idle without ADMIN_PASSWORD', async () => {
  const port = await freePort();
  const s = await startMockServer();
  const { host } = makeHost(s, [adminPanel], {}, { httpPort: port });
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    await assert.rejects(() => httpRequest(`http://127.0.0.1:${port}/admin`), 'nothing listening');
  } finally {
    await host.stop();
    await s.close();
  }
});
