import crypto from 'crypto';
import bcrypt from 'bcrypt';

const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 192 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;
const MAX_PASSWORD_BYTES = 1024;

const COMMON_PASSWORDS = new Set([
  '123456789012345',
  '1234567890123456',
  'passwordpassword',
  'password123456',
  'qwertyuiopasdfg',
  'letmeinletmein',
  'adminadminadmin',
  'correcthorsebatterystaple',
]);

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function scryptPassword(password: string, salt: Buffer, keyLength = SCRYPT_KEY_LENGTH): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

  const [local, domain] = email.split('@');
  if (!local || !domain || local.length > 64 || domain.length > 253) return null;
  if (domain.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    return null;
  }

  return email;
}

export function validatePassword(raw: string): string | null {
  const password = raw.normalize('NFC');
  const characterLength = Array.from(password).length;
  const byteLength = Buffer.byteLength(password, 'utf8');

  if (characterLength < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }
  if (characterLength > MAX_PASSWORD_LENGTH || byteLength > MAX_PASSWORD_BYTES) {
    return `Password must be no more than ${MAX_PASSWORD_LENGTH} characters long.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Choose a password that is not commonly used.';
  }
  return null;
}

export function isPasswordInputWithinLimit(raw: string): boolean {
  const password = raw.normalize('NFC');
  return Array.from(password).length <= MAX_PASSWORD_LENGTH
    && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
}

export async function hashPassword(raw: string): Promise<string> {
  const password = raw.normalize('NFC');
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptPassword(password, salt);
  return [
    '$scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(raw: string, storedHash: string): Promise<PasswordVerification> {
  const password = raw.normalize('NFC');
  if (!isPasswordInputWithinLimit(password)) return { valid: false, needsRehash: false };

  if (storedHash.startsWith('$2')) {
    return {
      valid: await bcrypt.compare(password, storedHash),
      needsRehash: true,
    };
  }

  const parts = storedHash.split('$');
  if (
    parts.length !== 7
    || parts[1] !== 'scrypt'
    || Number(parts[2]) !== SCRYPT_N
    || Number(parts[3]) !== SCRYPT_R
    || Number(parts[4]) !== SCRYPT_P
  ) {
    return { valid: false, needsRehash: false };
  }

  try {
    const salt = Buffer.from(parts[5], 'base64url');
    const expected = Buffer.from(parts[6], 'base64url');
    const actual = await scryptPassword(password, salt, expected.length);
    return {
      valid: expected.length === actual.length && crypto.timingSafeEqual(expected, actual),
      needsRehash: false,
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function privacyKey(value: string): string {
  return hashOpaqueToken(value.trim().toLowerCase());
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private operations = 0;

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    this.operations += 1;
    if (this.operations % 500 === 0) this.prune(now);

    const current = this.entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    if (entry.count >= limit) {
      this.entries.set(key, entry);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        remaining: 0,
      };
    }

    entry.count += 1;
    this.entries.set(key, entry);
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, limit - entry.count),
    };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}
