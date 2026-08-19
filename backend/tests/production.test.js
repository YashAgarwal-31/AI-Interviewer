import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell } from '../routes/results.js';
import { validateSessionTiming } from '../utils/sessionScheduler.js';

test('CSV export neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(csvCell('+1+1'), '"\'+1+1"');
  assert.equal(csvCell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
  assert.equal(csvCell('Normal candidate'), '"Normal candidate"');
});

test('active scheduled session is valid inside its access window', () => {
  const now = Date.now();
  const validation = validateSessionTiming({
    status: 'active',
    startTime: new Date(now - 60_000),
    endTime: new Date(now + 10 * 60_000),
    accessWindow: { beforeStart: 15, afterEnd: 15 },
    accessAttempts: 0,
    maxAccessAttempts: 5
  });
  assert.equal(validation.isValid, true);
  assert.equal(validation.shouldExpire, false);
});

test('cancelled scheduled session cannot continue', () => {
  const now = Date.now();
  const validation = validateSessionTiming({
    status: 'cancelled',
    startTime: new Date(now - 60_000),
    endTime: new Date(now + 10 * 60_000),
    accessWindow: { beforeStart: 15, afterEnd: 15 }
  });
  assert.equal(validation.isValid, false);
  assert.match(validation.reason, /cancelled/i);
});

test('session past the bounded after-end window is marked for expiry', () => {
  const now = Date.now();
  const validation = validateSessionTiming({
    status: 'active',
    startTime: new Date(now - 4 * 60 * 60_000),
    endTime: new Date(now - 3 * 60 * 60_000),
    accessWindow: { beforeStart: 9999, afterEnd: 9999 },
    accessAttempts: 0,
    maxAccessAttempts: 5
  });
  assert.equal(validation.isValid, false);
  assert.equal(validation.shouldExpire, true);
});