/** Live option editing: host API, persistence, restart-in-place, form encode/decode, and the panel action. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PluginHost } from '../host/host.ts';
import { createLogger } from '../host/logger.ts';
import { definePlugin } from '../host/plugin.ts';
import { RconClient } from '../rcon/client.ts';
import type { PluginContext } from '../host/plugin.ts';
import {
  decodeValue,
  encodeValue,
  kindOf,
  parseOptionFields,
  renderOptionFields,
} from '../host/options-form.ts';
import adminPanel from '../plugins/admin-panel.ts';
import motd from '../plugins/motd.ts';
import { freePort, httpRequest, player, startMockServer, TOKEN, waitFor } from './mock-server.ts';
import { makeHost, requestsTo } from './helpers.ts';

test('options-form: kinds, encode/decode round-trip, parse from a form', () => {
  assert.equal(kindOf(5), 'num');
  assert.equal(kindOf(true), 'bool');
  assert.equal(kindOf('x'), 'str');
  assert.equal(kindOf(['a', 'b']), 'lines');
  assert.equal(kindOf([{ visits: 3 }]), 'json');
  assert.equal(kindOf({ a: 1 }), 'json');

  assert.equal(encodeValue('lines', ['a', 'b']), 'a\nb');
  assert.deepEqual(decodeValue('lines', ' a \n\nb\r\n', 'k'), ['a', 'b']);
  assert.equal(decodeValue('num', ' 12.5 ', 'k'), 12.5);
  assert.throws(() => decodeValue('num', 'abc', 'k'), /not a number/);
  assert.equal(decodeValue('bool', 'true', 'k'), true);
  assert.equal(decodeValue('bool', 'false', 'k'), false);
  assert.deepEqual(decodeValue('json', '[{"visits":3}]', 'k'), [{ visits: 3 }]);
  assert.throws(() => decodeValue('json', '{oops', 'tiers'), /tiers: invalid JSON/);

  const form = new URLSearchParams({
    'o:intervalMinutes': '7',
    'k:intervalMinutes': 'num',
    'o:messages': 'one\ntwo',
    'k:messages': 'lines',
    'o:minPlayers': '',
    'k:minPlayers': 'num',
  });
  assert.throws(() => parseOptionFields(form), /minPlayers/);
  form.set('o:minPlayers', '2');
  assert.deepEqual(parseOptionFields(form), { intervalMinutes: 7, messages: ['one', 'two'], minPlayers: 2 });

  const html = renderOptionFields(
    { intervalMinutes: 10, messages: ['x'], on: true },
    { intervalMinutes: 3, messages: ['a', 'b'], on: false },
  );
  assert.match(html, /name="o:intervalMinutes" value="3"/);
  assert.match(html, /default: 10/);
  assert.match(html, /<textarea name="o:messages"[^>]*>a\nb<\/textarea>/);
  assert.match(html, /<option value="false" selected>/);
});

test('host: setPluginOptions persists and restarts the plugin with the new options', async () => {
  const s = await startMockServer({ state: { players: [player('a')] } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const pluginsFile = path.join(dataDir, 'plugins.json');
  fs.writeFileSync(
    pluginsFile,
    JSON.stringify({ greeter: { enabled: true, text: 'hi' }, sleeper: { enabled: false } }, null, 2),
  );

  const setups: string[] = [];
  let captured: PluginContext<unknown> | undefined;
  const greeter = definePlugin<{ text: string; times: number }>({
    name: 'greeter',
    description: '',
    defaults: { text: 'hello', times: 1 },
    setup(ctx) {
      setups.push(`${ctx.options.text}x${ctx.options.times}`);
      captured = ctx as PluginContext<unknown>;
    },
  });
  const sleeper = definePlugin<{ level: number }>({
    name: 'sleeper',
    description: '',
    defaults: { level: 1 },
    setup() {},
  });
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: { pollMs: 20, auditPollMs: 1000, dataDir, logLevel: 'error', pluginsFile },
    plugins: JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, { enabled?: boolean }>,
    registry: { greeter, sleeper },
    logger: createLogger('error'),
  });
  try {
    await host.start();
    assert.deepEqual(setups, ['hix1']);
    const before = host.listPlugins().find((p) => p.name === 'greeter')!;
    assert.deepEqual(before.options, { text: 'hi', times: 1 });
    assert.deepEqual(before.defaults, { text: 'hello', times: 1 });

    await captured!.setPluginOptions('greeter', { text: 'yo', times: 3 });
    assert.deepEqual(setups, ['hix1', 'yox3'], 'restarted in place with the new options');
    let saved = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.deepEqual(saved.greeter, { enabled: true, text: 'yo', times: 3 });
    assert.equal(host.listPlugins().find((p) => p.name === 'greeter')?.state, 'enabled');

    // A disabled plugin's options persist without starting it.
    await captured!.setPluginOptions('sleeper', { level: 9 });
    saved = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.deepEqual(saved.sleeper, { enabled: false, level: 9 });
    assert.equal(host.listPlugins().find((p) => p.name === 'sleeper')?.state, 'disabled');
    assert.deepEqual(host.listPlugins().find((p) => p.name === 'sleeper')?.options, { level: 9 });

    await captured!.resetPluginOptions('greeter');
    assert.deepEqual(setups, ['hix1', 'yox3', 'hellox1'], 'reset restarts with defaults');
    saved = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.deepEqual(saved.greeter, { enabled: true });
  } finally {
    await host.stop();
    await s.close();
  }
});

test('admin-panel: the CSRF token survives a service restart, so open tabs keep working', async () => {
  const port = await freePort();
  const s = await startMockServer();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const auth = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };
  const tokenOf = (body: string) => /name="_csrf" value="([a-f0-9]{32})"/.exec(body)?.[1];
  const over = { httpPort: port, adminPassword: 'hunter2hunter2', dataDir };
  try {
    const first = makeHost(s, [adminPanel], { 'admin-panel': { path: '/admin' } }, over).host;
    await first.start();
    const a = tokenOf((await httpRequest(`http://127.0.0.1:${port}/admin`, { headers: auth })).body);
    await first.stop();
    const second = makeHost(s, [adminPanel], { 'admin-panel': { path: '/admin' } }, over).host;
    await second.start();
    const b = tokenOf((await httpRequest(`http://127.0.0.1:${port}/admin`, { headers: auth })).body);
    await second.stop();
    assert.ok(a && b, 'both pages carry a token');
    assert.equal(a, b, 'same token after a restart with the same data dir');
  } finally {
    await s.close();
  }
});

test('admin-panel: editing options through the form saves and restarts the plugin', async () => {
  const port = await freePort();
  const s = await startMockServer({ state: { players: [player('a')] } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const pluginsFile = path.join(dataDir, 'plugins.json');
  fs.writeFileSync(
    pluginsFile,
    JSON.stringify(
      {
        'admin-panel': { enabled: true, path: '/admin' },
        motd: { enabled: true, intervalMinutes: 30, messages: ['old'] },
      },
      null,
      2,
    ),
  );
  const { host } = makeHost(
    s,
    [adminPanel, motd],
    { 'admin-panel': { path: '/admin' }, motd: { intervalMinutes: 30, messages: ['old'] } },
    { httpPort: port, adminPassword: 'hunter2hunter2', dataDir, pluginsFile },
  );
  const auth = { Authorization: `Basic ${Buffer.from('x:hunter2hunter2').toString('base64')}` };
  const base = `http://127.0.0.1:${port}`;
  try {
    await host.start();
    await waitFor(() => requestsTo(s, 'GET', '/v1/status').length >= 1);
    const page = await httpRequest(`${base}/admin`, { headers: auth });
    assert.match(page.body, /name="o:intervalMinutes" value="30"/, 'editor shows the current value');
    assert.match(page.body, /<textarea name="o:messages"[^>]*>old<\/textarea>/);
    const csrf = /name="_csrf" value="([a-f0-9]{32})"/.exec(page.body)![1]!;

    const post = (fields: Record<string, string>) =>
      httpRequest(`${base}/admin/action`, {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: `http://127.0.0.1:${port}`,
        },
        body: new URLSearchParams(fields).toString(),
      });

    const bad = await post({
      action: 'plugin-options',
      name: 'motd',
      'o:intervalMinutes': 'soon',
      'k:intervalMinutes': 'num',
      _csrf: csrf,
    });
    assert.match(decodeURIComponent(String(bad.headers.location)), /intervalMinutes: "soon" is not a number/);

    const ok = await post({
      action: 'plugin-options',
      name: 'motd',
      'o:intervalMinutes': '0.02',
      'k:intervalMinutes': 'num',
      'o:minPlayers': '1',
      'k:minPlayers': 'num',
      'o:messages': 'fresh one\nfresh two',
      'k:messages': 'lines',
      _csrf: csrf,
    });
    assert.match(decodeURIComponent(String(ok.headers.location)), /Saved motd/);
    // minPlayers=1 equals the default, so it is not written: plugins.json only carries overrides.
    const saved = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.deepEqual(saved.motd, {
      enabled: true,
      intervalMinutes: 0.02,
      messages: ['fresh one', 'fresh two'],
    });
    // The restarted motd uses the new 1.2 s interval and new messages.
    await waitFor(
      () => requestsTo(s, 'POST', '/v1/broadcast').length >= 1,
      4000,
      'broadcast with new options',
    );
    assert.deepEqual(JSON.parse(requestsTo(s, 'POST', '/v1/broadcast')[0]!.body), { message: 'fresh one' });

    const after = await httpRequest(`${base}/admin`, { headers: auth });
    assert.match(after.body, /name="o:intervalMinutes" value="0.02"/);
    assert.match(after.body, /Configure · 3 options · 2 customized/);
    assert.match(after.body, /default: 10/, 'shows the default next to a customized value');
    assert.match(
      after.body,
      /edit this plugin in plugins\.json/,
      'the panel does not offer to reconfigure itself',
    );

    // Restart keeps the options; reset drops them and the plugin comes back with defaults.
    const restarted = await post({ action: 'plugin-restart', name: 'motd', _csrf: csrf });
    assert.match(decodeURIComponent(String(restarted.headers.location)), /Restarted motd/);
    const self = await post({ action: 'plugin-reset', name: 'admin-panel', _csrf: csrf });
    assert.match(decodeURIComponent(String(self.headers.location)), /cannot restart itself/);
    const reset = await post({ action: 'plugin-reset', name: 'motd', _csrf: csrf });
    assert.match(
      decodeURIComponent(String(reset.headers.location)),
      /Reset motd to its defaults and restarted it/,
    );
    assert.deepEqual((JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Record<string, unknown>).motd, {
      enabled: true,
    });
    const final = await httpRequest(`${base}/admin`, { headers: auth });
    assert.match(final.body, /name="o:intervalMinutes" value="10"/);
    assert.match(final.body, /Configure · 3 options · all defaults/);
  } finally {
    await host.stop();
    await s.close();
  }
});

test('host: when plugins.json cannot be written the change still applies and the error says so', async () => {
  const s = await startMockServer();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdp-'));
  const setups: string[] = [];
  const p = definePlugin<{ text: string }>({
    name: 'p',
    description: '',
    defaults: { text: 'a' },
    setup(ctx) {
      setups.push(ctx.options.text);
    },
  });
  const host = new PluginHost({
    rcon: new RconClient({
      host: '127.0.0.1',
      port: s.port,
      scheme: 'http',
      password: TOKEN,
      tlsInsecure: false,
      timeoutMs: 500,
    }),
    config: {
      pollMs: 20,
      auditPollMs: 1000,
      dataDir,
      logLevel: 'error',
      pluginsFile: path.join(dataDir, 'missing', 'plugins.json'),
    },
    plugins: { p: { enabled: true } },
    registry: { p },
    logger: createLogger('error'),
  });
  try {
    await host.start();
    await assert.rejects(
      host.setPluginOptions('p', { text: 'b' }),
      /p was applied but NOT saved: could not write/,
    );
    assert.deepEqual(setups, ['a', 'b'], 'the plugin was still restarted with the new options');
    await assert.rejects(host.setPluginEnabled('p', false), /NOT saved/);
    assert.equal(host.listPlugins().find((x) => x.name === 'p')?.state, 'disabled');
  } finally {
    await host.stop();
    await s.close();
  }
});
