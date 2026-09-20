/** `{discord}` and other globals fill every template; the appeal note follows the invite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fill, setTemplateGlobals } from '../host/template.ts';
import adminPanel from '../plugins/admin-panel.ts';
import { freePort, httpRequest, player, startMockServer, waitFor } from './mock-server.ts';
import { makeHost, requestsTo, bodyOf } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };

test('template: globals fill what the plugin did not; per-call vars win; unknown stays visible', () => {
  setTemplateGlobals({ discord: 'discord.gg/abc', server: 'GLOBAL' });
  assert.equal(fill('Join {discord}, {name}!', { name: 'Rae' }), 'Join discord.gg/abc, Rae!');
  assert.equal(fill('on {server}', { server: 'Local' }), 'on Local', 'per-call beats global');
  assert.equal(fill('on {server}'), 'on GLOBAL');
  assert.equal(fill('{nope}'), '{nope}', 'unknown placeholders are left visible');
  setTemplateGlobals({});
  assert.equal(fill('Join {discord}'), 'Join {discord}', 'no invite configured: visible, not blank');
});

test('admin-panel: the appeal note uses {discord}; without an invite it is left off the ban', async () => {
  const port = await freePort();
  const s = await startMockServer({ state: { players: [player('a'), player('b')] } });
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
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(
      (await httpRequest(`${base}/admin`, { headers: AUTH })).body,
    )![1]!;
    const ban = (steamId: string) =>
      httpRequest(`${base}/admin/action`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
        body: new URLSearchParams({ action: 'ban', steamId, text: 'Griefing', _csrf: csrf }).toString(),
      });
    setTemplateGlobals({});
    await ban('a');
    setTemplateGlobals({ discord: 'discord.gg/wardogs' });
    await ban('b');
    const reasons = requestsTo(s, 'POST', '/v1/bans').map((r) => bodyOf<{ reason: string }>(r).reason);
    assert.deepEqual(reasons, ['Griefing', 'Griefing. Appeal at discord.gg/wardogs']);
  } finally {
    setTemplateGlobals({});
    await host.stop();
    await s.close();
  }
});
