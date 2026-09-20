/** Temp bans from the panel: ban with a length, expiry shown, Cleanup lifts what has expired. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import adminPanel from '../plugins/admin-panel.ts';
import tempBans from '../plugins/temp-bans.ts';
import { describeExpiry, durationMs } from '../host/temp-bans.ts';
import { freePort, httpRequest, player, startMockServer, waitFor } from './mock-server.ts';
import { makeHost, requestsTo } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };

test('temp-bans helpers: durations and expiry wording', () => {
  assert.equal(durationMs('30m'), 30 * 60_000);
  assert.equal(durationMs('12h'), 12 * 3_600_000);
  assert.equal(durationMs(' 3d '), 3 * 86_400_000);
  assert.equal(durationMs('2W'), 2 * 604_800_000);
  assert.equal(durationMs('0d'), null);
  assert.equal(durationMs('soon'), null);
  const now = Date.now();
  assert.equal(describeExpiry(new Date(now + 40 * 60_000).toISOString(), now), 'lifts in 40 min');
  assert.equal(describeExpiry(new Date(now + 5 * 3_600_000).toISOString(), now), 'lifts in 5 h');
  assert.equal(describeExpiry(new Date(now + 3 * 86_400_000).toISOString(), now), 'lifts in 3 d');
  assert.equal(describeExpiry(new Date(now - 1000).toISOString(), now), 'expired, lifts at next cleanup');
});

test('admin-panel: ban with a length records the expiry; Cleanup lifts expired ones; unban forgets', async () => {
  const port = await freePort();
  const s = await startMockServer({
    state: {
      players: [player('a')],
      bans: [{ steamId: 'old', bannedAtUtc: '2026-09-01T00:00:00Z', bannedBy: 'x', reason: 'past' }],
    },
  });
  const { host, dataDir } = makeHost(
    s,
    [adminPanel, tempBans],
    { 'admin-panel': { path: '/admin' }, 'temp-bans': { checkSeconds: 3600 } },
    { httpPort: port, adminPassword: 'hunter2hunter2' },
  );
  const base = `http://127.0.0.1:${port}`;
  const file = path.join(dataDir, 'temp-bans.json');
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    const first = await httpRequest(`${base}/admin`, { headers: AUTH });
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(first.body)![1]!;
    const post = (fields: Record<string, string>) =>
      httpRequest(`${base}/admin/action`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
        body: new URLSearchParams(fields).toString(),
      });
    const msg = (r: { headers: Record<string, unknown> }) =>
      decodeURIComponent(String(r.headers.location)).replace(/^\/admin\?msg=/, '');

    // a bad length bans nobody
    const bad = await post({ action: 'ban', steamId: 'a', text: 'x', duration: 'soon', _csrf: csrf });
    assert.match(msg(bad), /not valid/);
    assert.equal(requestsTo(s, 'POST', '/v1/bans').length, 0);

    // a temp ban: server ban + a record with the expiry, placed by the admin
    const temp = await post({ action: 'ban', steamId: 'a', text: 'cool off', duration: '2d', _csrf: csrf });
    assert.match(msg(temp), /^Banned Pa for 2d; lifts /);
    assert.equal(requestsTo(s, 'POST', '/v1/bans').length, 1);
    const records = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, unknown>>;
    assert.equal(records.length, 1);
    assert.equal(records[0]!.steamId, 'a');
    assert.equal(records[0]!.reason, 'cool off. Appeal at discord.gg/taw', 'the appeal note rides along');
    const by = String(records[0]!.by);
    assert.ok(by.length > 0, 'placed by the signed-in admin');
    const page = await httpRequest(`${base}/admin`, { headers: AUTH });
    assert.match(page.body, new RegExp(`lifts in 2 d <span class="def">by ${by}</span>`));
    assert.match(page.body, /<td><span class="muted">permanent<\/span><\/td>/, 'the old ban has no record');
    assert.match(
      page.body,
      /value="bans-cleanup"[^>]*>Cleanup<\/button><span class="def">1 temp ban<\/span>/,
    );

    // Cleanup with an expired record lifts it and keeps the live one
    fs.writeFileSync(
      file,
      JSON.stringify([
        ...records,
        { steamId: 'old', reason: 'past', expiresAt: new Date(Date.now() - 60_000).toISOString() },
      ]),
    );
    const cleaned = await post({ action: 'bans-cleanup', _csrf: csrf });
    assert.equal(msg(cleaned), 'Lifted 1 expired temp ban: old.');
    assert.equal(requestsTo(s, 'DELETE', '/v1/bans/old').length, 1);
    assert.deepEqual(
      (JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ steamId: string }>).map((b) => b.steamId),
      ['a'],
    );
    const nothing = await post({ action: 'bans-cleanup', _csrf: csrf });
    assert.equal(msg(nothing), 'No expired temp bans to lift.');

    // a manual unban drops the record too
    const unban = await post({ action: 'unban', steamId: 'a', _csrf: csrf });
    assert.equal(msg(unban), 'Unbanned a.');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  } finally {
    await host.stop();
    await s.close();
  }
});
