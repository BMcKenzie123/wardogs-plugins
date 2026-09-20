/** More than one game server: a prefixed panel path and the server switcher between panels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import adminPanel from '../plugins/admin-panel.ts';
import { freePort, httpRequest, player, startMockServer, waitFor } from './mock-server.ts';
import { makeHost, requestsTo } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };

test('admin-panel: a prefixed path serves the page and its actions; the switcher links the other panels', async () => {
  const port = await freePort();
  const s = await startMockServer({ state: { players: [player('a')] } });
  const { host } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/eu/admin', label: 'EU', otherPanels: [{ name: 'NA', url: '/admin' }] } },
    { httpPort: port, adminPassword: 'hunter2hunter2' },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    const page = await httpRequest(`${base}/eu/admin`, { headers: AUTH });
    assert.equal(page.status, 200);
    assert.match(page.body, /<p class="servers">Servers: <b>EU<\/b> · <a href="\/admin">NA<\/a><\/p>/);
    assert.match(page.body, /<title>Admin · EU · /);
    assert.match(page.body, /action="\/eu\/admin\/action"/);
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(page.body)![1]!;
    const post = await httpRequest(`${base}/eu/admin/action`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
      body: new URLSearchParams({ action: 'broadcast', text: 'hello eu', _csrf: csrf }).toString(),
    });
    assert.equal(post.status, 303);
    assert.equal(post.headers.location, '/eu/admin?msg=Broadcast%20sent.');
    assert.equal(JSON.parse(requestsTo(s, 'POST', '/v1/broadcast')[0]!.body).message, 'hello eu');
    const missing = await httpRequest(`${base}/admin`, { headers: AUTH });
    assert.equal(missing.status, 404, 'the un-prefixed path belongs to the other instance');
  } finally {
    await host.stop();
    await s.close();
  }
});

test('admin-panel: no label and no other panels means no switcher', async () => {
  const port = await freePort();
  const s = await startMockServer();
  const { host } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/admin' } },
    { httpPort: port, adminPassword: 'hunter2hunter2' },
  );
  try {
    await host.start();
    const page = await httpRequest(`http://127.0.0.1:${port}/admin`, { headers: AUTH });
    assert.doesNotMatch(page.body, /class="servers"/);
  } finally {
    await host.stop();
    await s.close();
  }
});
