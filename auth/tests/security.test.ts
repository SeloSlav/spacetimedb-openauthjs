import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import {
  FixedWindowRateLimiter,
  hashOpaqueToken,
  hashPassword,
  isPasswordInputWithinLimit,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from '../security.js';

test('normalizes valid emails and rejects malformed addresses', () => {
  assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('a@-example.com'), null);
});

test('enforces the server-side password policy', () => {
  assert.match(validatePassword('short') ?? '', /at least 15/);
  assert.match(validatePassword('correcthorsebatterystaple') ?? '', /commonly used/);
  assert.equal(validatePassword('a secure passphrase with 30 chars'), null);
  assert.equal(isPasswordInputWithinLimit('x'.repeat(129)), false);
});

test('scrypt hashes the entire password instead of truncating at 72 bytes', async () => {
  const prefix = 'A'.repeat(80);
  const storedHash = await hashPassword(`${prefix}-first-suffix`);
  assert.equal((await verifyPassword(`${prefix}-first-suffix`, storedHash)).valid, true);
  assert.equal((await verifyPassword(`${prefix}-other-suffix`, storedHash)).valid, false);
});

test('legacy bcrypt hashes remain usable but are marked for migration', async () => {
  const legacyHash = await bcrypt.hash('legacy password', 4);
  assert.deepEqual(await verifyPassword('legacy password', legacyHash), {
    valid: true,
    needsRehash: true,
  });
});

test('opaque token hashes are deterministic and do not expose the token', () => {
  const token = 'secret-refresh-token';
  const tokenHash = hashOpaqueToken(token);
  assert.equal(tokenHash, hashOpaqueToken(token));
  assert.equal(tokenHash.length, 64);
  assert.equal(tokenHash.includes(token), false);
});

test('fixed-window rate limits enforce retry windows and can be reset', () => {
  const limiter = new FixedWindowRateLimiter();
  assert.equal(limiter.consume('login:user', 2, 1_000, 1_000).allowed, true);
  assert.equal(limiter.consume('login:user', 2, 1_000, 1_100).allowed, true);
  const blocked = limiter.consume('login:user', 2, 1_000, 1_200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.consume('login:user', 2, 1_000, 2_001).allowed, true);
  limiter.reset('login:user');
  assert.equal(limiter.consume('login:user', 2, 1_000, 2_100).remaining, 1);
});
