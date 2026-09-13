import test from 'node:test';
import assert from 'node:assert/strict';
import { RconClient, RconConflictError, RconError } from '../rcon/client.ts';
import { startMockServer, TOKEN } from './mock-server.ts';
import type { RconConfig } from '../config.ts';

const cfg = (port: number, over: Partial<RconConfig> = {}): RconConfig => ({
  host: '127.0.0.1',
  port,
  scheme: 'http',
  password: TOKEN,
  tlsInsecure: false,
  timeoutMs: 2000,
  ...over,
});

test('client: sends bearer token and parses JSON', async () => {
  const s = await startMockServer();
  try {
    const c = new RconClient(cfg(s.port));
    const status = await c.status();
    assert.equal(status.map, 'Kavkazi');
    assert.equal(status.players.max, 64);
    const req = s.requests.at(-1)!;
    assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(req.headers.accept, 'application/json');
  } finally {
    await s.close();
  }
});

test('client: query params and path encoding', async () => {
  const s = await startMockServer();
  try {
    const c = new RconClient(cfg(s.port));
    await c.audit(25);
    assert.equal(s.requests.at(-1)!.path, '/v1/audit?limit=25');
    assert.match(s.requests.at(-1)!.headers.host ?? '', /127\.0\.0\.1/);
    await c.message('7656 1199', 'hi');
    assert.equal(s.requests.at(-1)!.path, '/v1/players/7656%201199/message');
    assert.deepEqual(JSON.parse(s.requests.at(-1)!.body), { message: 'hi' });
  } finally {
    await s.close();
  }
});

test('client: 404 and 401 map to RconError with status and code', async () => {
  const s = await startMockServer();
  try {
    const c = new RconClient(cfg(s.port));
    await assert.rejects(
      () => c.request('GET', '/v1/nope'),
      (e: unknown) => e instanceof RconError && e.status === 404 && e.code === 'NOT_FOUND',
    );
    const bad = new RconClient(cfg(s.port, { password: 'wrong' }));
    await assert.rejects(
      () => bad.status(),
      (e: unknown) => e instanceof RconError && e.status === 401 && e.code === 'UNAUTHORIZED',
    );
  } finally {
    await s.close();
  }
});

test('client: config put honours If-Match and surfaces 412 as RconConflictError', async () => {
  const s = await startMockServer();
  try {
    const c = new RconClient(cfg(s.port));
    await assert.rejects(
      () => c.putConfig('[X]\n', { ifMatch: 'stale' }),
      (e: unknown) => e instanceof RconConflictError && e.status === 412 && e.result.revision === 'r1',
    );
    const ok = await c.putConfig('[X]\n', { ifMatch: 'r1' });
    assert.equal(ok.ok, true);
    assert.equal(ok.revision, 'r2');
    const put = s.requests.at(-1)!;
    assert.equal(put.headers['content-type'], 'text/plain');
    assert.equal(put.headers['if-match'], '"r1"');
    assert.equal(put.body, '[X]\n');
    const forced = await c.putConfig('[Y]\n', { force: true });
    assert.equal(forced.revision, 'r3');
  } finally {
    await s.close();
  }
});

test('client: timeout and connection refused become RconError status 0', async () => {
  const s = await startMockServer();
  try {
    const c = new RconClient(cfg(s.port, { timeoutMs: 50 }));
    await assert.rejects(
      () => c.request('GET', '/slow'),
      (e: unknown) => e instanceof RconError && e.status === 0 && e.code === 'TIMEOUT',
    );
  } finally {
    await s.close();
  }
  const dead = new RconClient(cfg(s.port, { timeoutMs: 500 }));
  await assert.rejects(
    () => dead.status(),
    (e: unknown) => e instanceof RconError && e.status === 0 && e.code !== 'TIMEOUT',
  );
});

test('client: hasRoute normalises path parameter names', () => {
  const caps = {
    routes: ['GET /v1/status', 'PATCH /v1/players/{id}', 'DELETE /v1/rotation/entries/{i}'],
    config: { writable: true },
  };
  assert.equal(RconClient.hasRoute(caps, 'patch', '/v1/players/{steamId}'), true);
  assert.equal(RconClient.hasRoute(caps, 'DELETE', '/v1/rotation/entries/{index}'), true);
  assert.equal(RconClient.hasRoute(caps, 'POST', '/v1/players/{id}'), false);
  assert.equal(RconClient.hasRoute(caps, 'GET', '/v1/players'), false);
});
