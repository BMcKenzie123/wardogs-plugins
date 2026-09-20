import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticate,
  generatePassword,
  hashPassword,
  parseAdminUsers,
  verifyPassword,
} from '../host/admins.ts';

test('admins: hash round-trips and rejects wrong passwords', () => {
  const hash = hashPassword('correct horse');
  assert.match(hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(verifyPassword('correct horse', hash), true);
  assert.equal(verifyPassword('correct horsf', hash), false);
  assert.equal(verifyPassword('correct horse', 'plain:nope'), false);
  assert.notEqual(hashPassword('x'), hashPassword('x'), 'fresh salt each time');
});

test('admins: parseAdminUsers accepts hashed entries only', () => {
  const h = hashPassword('pw');
  assert.deepEqual(
    parseAdminUsers(` jdam:${h} , ralf:${h}`).map((u) => u.name),
    ['jdam', 'ralf'],
  );
  assert.deepEqual(parseAdminUsers(undefined), []);
  assert.throws(() => parseAdminUsers('jdam:plaintext'), /not a scrypt hash/);
  assert.throws(() => parseAdminUsers('nocolon'), /bad ADMIN_USERS entry/);
  assert.throws(() => parseAdminUsers(`bad name:${h}`), /must be 1-32/);
});

test('admins: generatePassword is long and unambiguous', () => {
  const p = generatePassword();
  assert.equal(p.length, 20);
  assert.match(p, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/);
  assert.notEqual(generatePassword(), generatePassword());
});

test('admins: authenticate prefers named users, falls back to the shared password', () => {
  const users = parseAdminUsers(`jdam:${hashPassword('jdam-pass-1')}`);
  assert.equal(authenticate('jdam', 'jdam-pass-1', users, undefined), 'jdam');
  assert.equal(authenticate('jdam', 'wrong', users, undefined), null);
  assert.equal(authenticate('ralf', 'jdam-pass-1', users, undefined), null, 'password bound to the name');
  assert.equal(authenticate('anyone', 'shared-secret', users, 'shared-secret'), 'anyone');
  assert.equal(authenticate('', 'shared-secret', users, 'shared-secret'), 'admin');
  assert.equal(
    authenticate('anyone', 'short', users, 'short'),
    null,
    'shared password under 8 chars is ignored',
  );
});
