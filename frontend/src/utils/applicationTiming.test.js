import test from 'node:test';
import assert from 'node:assert/strict';
import { getAverageApprovalTiming, getElapsedMilliseconds } from './applicationTiming.js';

const submitted_at = '2026-10-26T01:00:00+08:00';

test('average uses approval milestones across statuses without updated_at', () => {
  const result = getAverageApprovalTiming([
    { submitted_at, approved_at: '2026-10-26T01:02:00+08:00', status: 'slot_assigned' },
    { submitted_at, approved_at: '2026-10-26T01:08:00+08:00', status: 'completed', updated_at: '2026-12-01T00:00:00Z' },
    { submitted_at, status: 'rejected', updated_at: '2026-10-27T01:00:00+08:00' },
  ]);
  assert.deepEqual(result, { count: 2, averageMs: 5 * 60000 });
});

test('missing, invalid, and reversed timings do not enter the denominator', () => {
  const result = getAverageApprovalTiming([
    { submitted_at, approved_at: submitted_at },
    { submitted_at, approved_at: null },
    { submitted_at: 'invalid', approved_at: submitted_at },
    { submitted_at, approved_at: '2026-10-26T00:59:00+08:00' },
    { approved_at: submitted_at },
  ]);
  assert.deepEqual(result, { count: 1, averageMs: 0 });
  assert.deepEqual(getAverageApprovalTiming([]), { count: 0, averageMs: null });
  assert.deepEqual(getAverageApprovalTiming([{ submitted_at }]), { count: 0, averageMs: null });
});

test('submission takes precedence over creation and legacy creation remains a fallback', () => {
  assert.deepEqual(getAverageApprovalTiming([
    { submitted_at, created_at: '2026-10-25T01:00:00+08:00', approved_at: '2026-10-26T01:10:00+08:00' },
    { created_at: submitted_at, approved_at: '2026-10-26T01:20:00+08:00' },
  ]), { count: 2, averageMs: 15 * 60000 });
});

test('equivalent UTC/local timestamps and sub-minute durations retain precision', () => {
  assert.equal(getElapsedMilliseconds(submitted_at, '2026-10-25T17:00:30Z'), 30000);
  assert.deepEqual(getAverageApprovalTiming([
    { submitted_at, approved_at: '2026-10-25T17:00:30Z' },
    { submitted_at, approved_at: '2026-10-25T17:01:00Z' },
  ]), { count: 2, averageMs: 45000 });
});
