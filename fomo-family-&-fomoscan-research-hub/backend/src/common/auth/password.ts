import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// scrypt params (CPU ~100ms, interactive-login grade). Do NOT weaken.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

function scryptAsync(password: string, salt: Buffer, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLen, { N, r: R, p: P }, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validate credential inputs. Returns the error message or null when OK. */
export function validateCredentials(input: { username?: unknown; email?: unknown; password?: unknown }): string | null {
  const { username, email, password } = input;
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username 3–32 ký tự, chỉ gồm chữ/số/gạch dưới.';
  }
  if (email !== undefined && email !== null && email !== '' && (typeof email !== 'string' || !EMAIL_RE.test(email))) {
    return 'Email không hợp lệ.';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Mật khẩu tối thiểu 8 ký tự.';
  }
  if (password.length > 128) return 'Mật khẩu tối đa 128 ký tự.';
  return null;
}

/** Hash a password: `scrypt$N$r$p$saltHex$keyHex`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Verify a password against a stored hash (timing-safe, false on any error). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, n, r, p, saltHex, keyHex] = stored.split('$');
    if (algo !== 'scrypt' || !n || !r || !p || !saltHex || !keyHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const keyLen = Buffer.from(keyHex, 'hex').length;
    const key = await new Promise<Buffer>((resolve, reject) => {
      scryptCb(password, salt, keyLen, { N: parseInt(n, 10), r: parseInt(r, 10), p: parseInt(p, 10) }, (err, k) => {
        if (err) reject(err);
        else resolve(k as Buffer);
      });
    });
    const expected = Buffer.from(keyHex, 'hex');
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
