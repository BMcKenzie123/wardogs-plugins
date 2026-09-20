/** Appeals and accountability: every ban says where to appeal; every admin action is recorded durably. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import adminPanel from '../plugins/admin-panel.ts';
import { freePort, httpRequest, player, startMockServer, waitFor } from './mock-server.ts';
import { makeHost, requestsTo, bodyOf } from './helpers.ts';

const AUTH = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };

test('admin-panel: ban reasons carry the appeal note; actions land in admin-actions.jsonl', async () => {
  const port = await freePort();
  const s = await startMockServer({ state: { players: [player('a'), player('b')] } });
  const { host, dataDir } = makeHost(
    s,
    [adminPanel],
    { 'admin-panel': { path: '/admin', appealNote: 'Appeal at discord.gg/taw' } },
    { httpPort: port, adminPassword: 'hunter2hunter2' },
  );
  const base = `http://127.0.0.1:${port}`;
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(
      (await httpRequest(`${base}/admin`, { headers: AUTH })).body,
    )![1]!;
    const post = (fields: Record<string, string>) =>
      httpRequest(`${base}/admin/action`, {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
        body: new URLSearchParams(fields).toString(),
      });

    await post({ action: 'ban', steamId: 'a', text: 'Cheating.', _csrf: csrf });
    await post({ action: 'ban', steamId: 'b', text: '', duration: '1d', _csrf: csrf });
    await post({ action: 'kick', steamId: 'a', text: 'bye', _csrf: csrf });
    await post({ action: 'nothing', _csrf: csrf });

    const bans = requestsTo(s, 'POST', '/v1/bans').map((r) => bodyOf<{ steamId: string; reason: string }>(r));
    assert.deepEqual(bans, [
      { steamId: 'a', reason: 'Cheating. Appeal at discord.gg/taw' },
      { steamId: 'b', reason: 'Appeal at discord.gg/taw' },
    ]);
    const temp = JSON.parse(fs.readFileSync(path.join(dataDir, 'temp-bans.json'), 'utf8')) as Array<{
      reason: string;
    }>;
    assert.equal(
      temp[0]!.reason,
      'Appeal at discord.gg/taw',
      'the temp record keeps the reason the player saw',
    );

    await waitFor(() => {
      try {
        return (
          fs.readFileSync(path.join(dataDir, 'admin-actions.jsonl'), 'utf8').trim().split('\n').length === 4
        );
      } catch {
        return false;
      }
    });
    const lines = fs
      .readFileSync(path.join(dataDir, 'admin-actions.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 4);
    assert.equal(lines[0]!.action, 'ban');
    assert.equal(lines[0]!.target, 'a');
    assert.equal(lines[0]!.text, 'Cheating.');
    assert.equal(lines[0]!.ok, true);
    assert.match(String(lines[0]!.result), /^Banned Pa permanently/);
    assert.ok(typeof lines[0]!.admin === 'string' && (lines[0]!.admin as string).length > 0);
    assert.equal(lines[1]!.duration, '1d');
    assert.equal(lines[2]!.action, 'kick');
    assert.equal(lines[3]!.ok, true, 'an unknown action is a reported outcome, not an exception');
    assert.match(String(lines[3]!.result), /Unknown action/);
    assert.match(String(lines[0]!.t), /^\d{4}-\d\d-\d\dT/);
  } finally {
    await host.stop();
    await s.close();
  }
});
