/** Audit noise filter and the panel's same-origin rule (proxy headers, Origin: null). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isNoiseAudit } from '../host/audit.ts';
import { sameOrigin } from '../plugins/admin-panel.ts';

test('isNoiseAudit: drops connection bookkeeping and read-only calls, keeps writes and failed auths', () => {
  assert.equal(isNoiseAudit({ event: 'ACCEPT', detail: 'null' }), true);
  assert.equal(isNoiseAudit({ event: 'AUTH_OK', detail: 'null' }), true);
  assert.equal(isNoiseAudit({ event: 'HTTP', detail: 'GET /v1/status -> 200' }), true);
  assert.equal(isNoiseAudit({ event: 'HTTP', detail: 'GET /v1/players -> 200' }), true);
  assert.equal(isNoiseAudit({ event: 'HTTP', detail: 'POST /v1/players/7656/kick -> 200' }), false);
  assert.equal(isNoiseAudit({ event: 'HTTP', detail: 'PUT /v1/config -> 200' }), false);
  assert.equal(isNoiseAudit({ event: 'HTTP', detail: 'DELETE /v1/bans/7656 -> 200' }), false);
  assert.equal(isNoiseAudit({ event: 'AUTH_FAIL', detail: 'bad token' }), false);
  assert.equal(isNoiseAudit({ event: 'KICK', detail: '7656' }), false);
});

test('sameOrigin: matching host passes, foreign host fails, null/missing rely on the token', () => {
  const host = '65-108-108-235.sslip.io';
  assert.equal(sameOrigin({ host, origin: `https://${host}` }), true);
  assert.equal(sameOrigin({ host, referer: `https://${host}/admin` }), true);
  assert.equal(sameOrigin({ host, origin: 'https://evil.example' }), false);
  assert.equal(sameOrigin({ host, origin: 'null', referer: 'https://evil.example/x' }), false);
  assert.equal(sameOrigin({ host, origin: 'null' }), true, 'no-referrer policy: Origin null, no Referer');
  assert.equal(sameOrigin({ host }), true, 'no origin at all');
  assert.equal(sameOrigin({ host, origin: '::not a url::' }), false);
  // A proxy that rewrites Host still forwards the public one.
  assert.equal(
    sameOrigin({ host: '127.0.0.1:8787', 'x-forwarded-host': host, origin: `https://${host}` }),
    true,
  );
  assert.equal(
    sameOrigin({ host: '127.0.0.1:8787', 'x-forwarded-host': host, origin: 'https://evil.example' }),
    false,
  );
});
