import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createScheduledSession,
  initializeScheduledSessions,
  patchScheduledSession,
  rotateScheduledAccessToken,
  updateSessionStatus,
  validateSessionTiming,
  verifyScheduledAccessToken
} from '../utils/sessionScheduler.js';

class MemoryCollection {
  constructor() {
    this.records = new Map();
    this.indexes = [];
  }

  async createIndex(key, options = {}) {
    this.indexes.push({ key, options });
    return `index-${this.indexes.length}`;
  }

  async insertOne(document) {
    this.records.set(document.sessionId, structuredClone(document));
    return { insertedId: `memory-${this.records.size}` };
  }

  async findOne(query) {
    const record = this.records.get(String(query.sessionId));
    return record ? structuredClone(record) : null;
  }

  async updateOne(query, update) {
    const key = String(query.sessionId);
    const record = this.records.get(key);
    if (!record) return { matchedCount: 0, modifiedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) this.#set(record, path, value);
    for (const path of Object.keys(update.$unset || {})) this.#unset(record, path);
    this.records.set(key, record);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(query, update) {
    await this.updateOne(query, update);
    return this.findOne(query);
  }

  #set(record, path, value) {
    const parts = path.split('.');
    const final = parts.pop();
    const target = parts.reduce((current, part) => current[part] ||= {}, record);
    target[final] = structuredClone(value);
  }

  #unset(record, path) {
    const parts = path.split('.');
    const final = parts.pop();
    const target = parts.reduce((current, part) => current?.[part], record);
    if (target) delete target[final];
  }
}

async function setupScheduler() {
  const collection = new MemoryCollection();
  await initializeScheduledSessions({ collection: () => collection });
  return collection;
}

function validSession(overrides = {}) {
  const now = Date.now();
  return {
    candidateId: 'candidate-1',
    candidateName: 'Yash Agarwal',
    candidateEmail: 'YASH@EXAMPLE.COM',
    startTime: new Date(now + 5 * 60_000),
    endTime: new Date(now + 65 * 60_000),
    accessWindow: { beforeStart: 15, afterEnd: 15 },
    ...overrides
  };
}

test('scheduler creates required indexes and stores only the token hash', async () => {
  const collection = await setupScheduler();
  const created = await createScheduledSession(validSession());
  const stored = collection.records.get(created.sessionId);

  assert.equal(collection.indexes.length, 5);
  assert.equal(created.candidateEmail, 'yash@example.com');
  assert.equal(created.status, 'scheduled');
  assert.equal(created.duration, 60);
  assert.equal(verifyScheduledAccessToken(stored, created.accessToken), true);
  assert.equal(stored.accessToken, undefined);
  assert.equal(stored.security.accessToken, undefined);
  assert.notEqual(stored.security.accessTokenHash, created.accessToken);
});

test('scheduler rejects incomplete and reversed session windows', async () => {
  await setupScheduler();
  await assert.rejects(() => createScheduledSession(validSession({ candidateId: '' })), /candidateId is required/);
  await assert.rejects(
    () => createScheduledSession(validSession({ startTime: '2026-09-10', endTime: '2026-09-09' })),
    /endTime must be after startTime/
  );
});

test('access-window and attempt settings are safely bounded', async () => {
  await setupScheduler();
  const created = await createScheduledSession(validSession({
    accessWindow: { beforeStart: 9999, afterEnd: -1 },
    maxAccessAttempts: 'invalid'
  }));

  assert.equal(created.accessWindow.beforeStart, 120);
  assert.equal(created.accessWindow.afterEnd, 15);
  assert.equal(created.maxAccessAttempts, 5);
  assert.equal(validateSessionTiming(created).isValid, true);
});

test('token rotation invalidates the previous credential without storing plaintext', async () => {
  const collection = await setupScheduler();
  const created = await createScheduledSession(validSession());
  const rotated = await rotateScheduledAccessToken(created.sessionId);
  const stored = collection.records.get(created.sessionId);

  assert.notEqual(rotated, created.accessToken);
  assert.equal(verifyScheduledAccessToken(stored, created.accessToken), false);
  assert.equal(verifyScheduledAccessToken(stored, rotated), true);
  assert.equal(stored.accessToken, undefined);
  assert.equal(stored.security.accessToken, undefined);
});

test('generic session patches cannot replace identity or security fields', async () => {
  const collection = await setupScheduler();
  const created = await createScheduledSession(validSession());
  const originalHash = collection.records.get(created.sessionId).security.accessTokenHash;
  const patched = await patchScheduledSession(created.sessionId, {
    sessionId: 'attacker-session',
    createdAt: new Date(0),
    security: { accessTokenHash: 'attacker-hash' },
    notes: 'safe update'
  });

  assert.equal(patched.sessionId, created.sessionId);
  assert.equal(patched.security.accessTokenHash, originalHash);
  assert.notEqual(patched.createdAt.getTime(), 0);
  assert.equal(patched.notes, 'safe update');
});

test('session status accepts only the documented state machine values', async () => {
  const collection = await setupScheduler();
  const created = await createScheduledSession(validSession());
  await assert.rejects(() => updateSessionStatus(created.sessionId, 'unknown'), /Invalid session status/);
  await updateSessionStatus(created.sessionId, 'cancelled');
  assert.equal(collection.records.get(created.sessionId).status, 'cancelled');
});
