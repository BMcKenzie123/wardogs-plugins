import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Named admin logins for the admin panel. Stored as scrypt hashes in ADMIN_USERS:
 *   ADMIN_USERS=jdam:scrypt:<salt>:<hash>,ralf:scrypt:<salt>:<hash>
 * Make an entry with `wd admin-hash <name>` (prints a generated password once) and paste it in.
 */
export interface AdminUser {
  name: string;
  hash: string;
}

const SCHEME = 'scrypt';
const PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const key = scryptSync(password, salt, 32, PARAMS);
  return `${SCHEME}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== SCHEME || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const key = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, PARAMS);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Parse ADMIN_USERS. Plaintext entries are rejected so a password never sits in .env by accident. */
export function parseAdminUsers(spec: string | undefined): AdminUser[] {
  return (spec ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx < 1) throw new Error(`bad ADMIN_USERS entry "${entry}" (expected name:scrypt:salt:hash)`);
      const name = entry.slice(0, idx);
      const hash = entry.slice(idx + 1);
      if (!hash.startsWith(`${SCHEME}:`))
        throw new Error(
          `ADMIN_USERS entry for "${name}" is not a scrypt hash; make one with: wd admin-hash ${name}`,
        );
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(name))
        throw new Error(`admin name "${name}" must be 1-32 letters, digits, . _ -`);
      return { name, hash };
    });
}

/** Random password from an unambiguous alphabet (no 0/O, 1/l/I); 20 chars ≈ 117 bits. */
export function generatePassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const limit = 256 - (256 % alphabet.length); // rejection sampling keeps the draw uniform
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Resolve Basic-auth credentials: a named user in ADMIN_USERS first, then the shared ADMIN_PASSWORD
 * (any username). Returns the name to log actions under, or null.
 */
export function authenticate(
  user: string,
  password: string,
  users: AdminUser[],
  sharedPassword: string | undefined,
): string | null {
  const named = users.find((u) => u.name === user);
  if (named && verifyPassword(password, named.hash)) return named.name;
  if (sharedPassword && sharedPassword.length >= 8) {
    const a = Buffer.from(password);
    const b = Buffer.from(sharedPassword);
    if (a.length === b.length && timingSafeEqual(a, b)) return user || 'admin';
  }
  return null;
}
