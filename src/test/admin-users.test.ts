/** Admin panel with named admins (ADMIN_USERS) instead of the shared password. */
import test from 'node:test';
import assert from 'node:assert/strict';
import adminPanel from '../plugins/admin-panel.ts';
import { hashPassword } from '../host/admins.ts';
import { freePort, httpRequest, player, startMockServer, waitFor } from './mock-server.ts';
import { bodyOf, makeHost, requestsTo } from './helpers.ts';

const basic = (user: string, pass: string) => ({
  Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
});

test('admin-panel: named admins log in with their own password and actions carry their name', async () => {
  const port = await freePort();
  const s = await startMockServer({ state: { players: [player('a', { name: 'Ann' })] } });
  const adminUsers = `jdam:${hashPassword('jdam-secret-1')},ralf:${hashPassword('ralf-secret-2')}`;
  const { host } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/admin' } },
    { httpPort: port, adminUsers },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);

    assert.equal(
      (await httpRequest(`${base}/admin`, { headers: basic('jdam', 'ralf-secret-2') })).status,
      401,
      'password is bound to the name',
    );
    assert.equal(
      (await httpRequest(`${base}/admin`, { headers: basic('someone', 'jdam-secret-1') })).status,
      401,
      'no shared password configured',
    );

    const page = await httpRequest(`${base}/admin`, { headers: basic('ralf', 'ralf-secret-2') });
    assert.equal(page.status, 200);
    assert.match(page.body, /signed in as <b>ralf<\/b>/);
    assert.match(page.body, /2 named admin\(s\)/);
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(page.body)![1]!;

    const kick = await httpRequest(`${base}/admin/action`, {
      method: 'POST',
      headers: {
        ...basic('jdam', 'jdam-secret-1'),
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: `http://127.0.0.1:${port}`,
      },
      body: new URLSearchParams({ action: 'kick', steamId: 'a', text: 'bye', _csrf: csrf }).toString(),
    });
    assert.equal(kick.status, 303);
    assert.deepEqual(bodyOf(requestsTo(s, 'POST', '/v1/players/a/kick')[0]), { reason: 'bye' });
  } finally {
    await host.stop();
    await s.close();
  }
});

test('admin-panel: invalid ADMIN_USERS keeps the panel idle', async () => {
  const port = await freePort();
  const s = await startMockServer();
  const { host } = makeHost(
    s,
    [adminPanel],
    {},
    { httpPort: port, adminUsers: 'jdam:plaintext-not-allowed' },
  );
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    await assert.rejects(() => httpRequest(`http://127.0.0.1:${port}/admin`), 'nothing listening');
  } finally {
    await host.stop();
    await s.close();
  }
});
