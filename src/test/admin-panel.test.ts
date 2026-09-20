import test from 'node:test';
import assert from 'node:assert/strict';
import adminPanel, { formatLogLine, namesFrom } from '../plugins/admin-panel.ts';
import firstTimer from '../plugins/first-timer.ts';
import { freePort, httpRequest, player, sleep, startMockServer, waitFor } from './mock-server.ts';
import { bodyOf, makeHost, requestsTo } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('anyone:hunter2hunter2').toString('base64')}` };

test('admin-panel: helpers', () => {
  assert.deepEqual(namesFrom(['Kavkazi', 'Europe']), ['Kavkazi', 'Europe']);
  assert.deepEqual(namesFrom({ maps: [{ id: 'Kavkazi', name: 'Kavkazi' }, { name: 'Ozeti' }] }), [
    'Kavkazi',
    'Ozeti',
  ]);
  assert.deepEqual(namesFrom('nope'), []);
  assert.equal(
    formatLogLine('2026-09-20T17:38:45.610Z INFO  [host:welcome] welcomed <Bo>'),
    '<span class="">17:38:45 INFO </span> <span class="who">[welcome]</span> welcomed &lt;Bo&gt;',
  );
  assert.match(formatLogLine('2026-09-20T17:38:45.610Z WARN  [host] server down'), /class="warn"/);
});

test('admin-panel: auth, csrf, actions, and plugin toggles', async () => {
  const port = await freePort();
  const s = await startMockServer({
    state: { players: [player('a', { name: 'Ann' }), player('b', { name: 'Bo' })] },
  });
  const { host } = makeHost(
    s,
    [adminPanel, firstTimer],
    { 'admin-panel': { path: '/admin' }, 'first-timer': { enabled: true } },
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
    assert.match(page.body, /Automation/);
    assert.match(page.body, /<b>first-timer<\/b><\/td><td><span class="pill enabled">/);
    assert.match(page.body, /background:#1C1C1C/, 'dark theme');
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

    // A missing or stale token runs nothing and sends the admin back to a fresh page (not a bare 403).
    const noCsrf = await post({ action: 'kick', steamId: 'a' });
    assert.equal(noCsrf.status, 303);
    assert.match(decodeURIComponent(String(noCsrf.headers.location)), /out of date/);
    assert.equal(requestsTo(s, 'POST', '/v1/players/a/kick').length, 0);

    // A post from another origin is refused outright even with a valid token.
    const crossOrigin = await httpRequest(`${base}/admin/action`, {
      method: 'POST',
      headers: {
        ...AUTH,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.example',
      },
      body: new URLSearchParams({ action: 'kick', steamId: 'a', _csrf: csrf! }).toString(),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(requestsTo(s, 'POST', '/v1/players/a/kick').length, 0);

    // Browsers send "Origin: null" for same-site form posts under Referrer-Policy: no-referrer (what a
    // hardened reverse proxy adds). That is unknown, not foreign: the token decides.
    const nullOrigin = await httpRequest(`${base}/admin/action`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'null' },
      body: new URLSearchParams({ action: 'dm', steamId: 'a', text: 'via proxy', _csrf: csrf! }).toString(),
    });
    assert.equal(nullOrigin.status, 303);
    assert.match(String(nullOrigin.headers.location), /msg=DM%20sent/);
    assert.equal(bodyOf(requestsTo(s, 'POST', '/v1/players/a/message').at(-1)).message, 'via proxy');

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

    // Automation: switch first-timer off through the panel, then a new join must not trigger it.
    const off = await post({ action: 'plugin', name: 'first-timer', enabled: '0', _csrf: csrf! });
    assert.match(decodeURIComponent(String(off.headers.location)), /Disabled first-timer/);
    const after = await httpRequest(`${base}/admin`, { headers: AUTH });
    assert.match(after.body, /<b>first-timer<\/b><\/td><td><span class="pill disabled">/);
    s.state.players.push(player('c', { name: 'Cy' }));
    await sleep(120);
    assert.equal(requestsTo(s, 'POST', '/v1/broadcast').length, 1, 'no first-timer broadcast once disabled');

    const self = await post({ action: 'plugin', name: 'admin-panel', enabled: '0', _csrf: csrf! });
    assert.match(decodeURIComponent(String(self.headers.location)), /Refusing/);
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
