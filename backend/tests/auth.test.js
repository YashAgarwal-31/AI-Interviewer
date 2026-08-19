import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, normalizeEmail, validatePassword, verifyPassword } from '../utils/auth.js';
import { generateAccessToken, hashAccessToken, safeEqual, verifyAccessToken } from '../utils/security.js';

test('password policy rejects weak credentials', () => {
  assert.match(validatePassword('short'), /at least 12/i);
  assert.match(validatePassword('alllowercase123'), /uppercase/i);
  assert.match(validatePassword('ALLUPPERCASE123'), /lowercase/i);
  assert.match(validatePassword('NoNumbersHere!'), /number/i);
  assert.equal(validatePassword('StrongPassword123'), null);
});

test('password hashing verifies correct password and rejects wrong password', async () => {
  const password = 'StrongPassword123';
  const { salt, hash } = await hashPassword(password);
  assert.ok(salt.length >= 32);
  assert.ok(hash.length >= 128);
  assert.equal(await verifyPassword(password, salt, hash), true);
  assert.equal(await verifyPassword('WrongPassword123', salt, hash), false);
});

test('email normalization is deterministic', () => {
  assert.equal(normalizeEmail('  Recruiter@Example.COM  '), 'recruiter@example.com');
});

test('interview access tokens are random and verify only against their hash', () => {
  const first = generateAccessToken();
  const second = generateAccessToken();
  assert.notEqual(first, second);
  assert.equal(first.length, 64);

  const record = { security: { accessTokenHash: hashAccessToken(first) } };
  assert.equal(verifyAccessToken(record, first), true);
  assert.equal(verifyAccessToken(record, second), false);
  assert.equal(safeEqual('same-value', 'same-value'), true);
  assert.equal(safeEqual('same-value', 'different'), false);
});
