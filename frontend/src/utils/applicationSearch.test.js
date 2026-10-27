import test from 'node:test';
import assert from 'node:assert/strict';
import { selectApplicationList, applicationWaitingLabel } from './applicationSearch.js';

const records = [
  { id: 1, applicant_name: 'Ana Cruz', submitted_at: '2026-10-20T16:00:00Z' },
  { id: 2, applicant_name: 'Ben Cruz', created_at: '2026-10-20T15:59:59Z' },
  { id: 3, applicant_name: 'Ana Reyes', submitted_at: '2026-10-22T00:00:00Z' },
  { id: 4, applicant_name: 'Ana Cruz', created_at: 'invalid' },
];
test('submission date filters include the full Manila day and combine with search', () => {
  assert.deepEqual(selectApplicationList(records, 'Ana', { from: '2026-10-21', to: '2026-10-21' }).map(row => row.id), [1]);
  assert.deepEqual(selectApplicationList(records, '', { to: '2026-10-20' }).map(row => row.id), [2]);
});
test('sorting keeps undated records last and does not mutate the source', () => {
  assert.deepEqual(selectApplicationList(records, '').map(row => row.id), [2, 1, 3, 4]);
  assert.deepEqual(selectApplicationList(records, '', { order: 'newest' }).map(row => row.id), [3, 1, 2, 4]);
  assert.deepEqual(records.map(row => row.id), [1, 2, 3, 4]);
});
test('clearing filters retains undated applications and transfer requests can use their date', () => {
  assert.equal(selectApplicationList(records, '').length, 4);
  assert.equal(selectApplicationList([{ user: 'Ana', date: '2026-10-21' }], 'Ana', { from: '2026-10-21', to: '2026-10-21' }).length, 1);
  assert.equal(selectApplicationList(records, '', { from: '2026-10-22', to: '2026-10-20' }).length, 0);
});
test('waiting labels do not invent durations for missing or future submissions', () => {
  const now = Date.parse('2026-10-23T16:00:00Z');
  assert.equal(applicationWaitingLabel(records[0], now), 'Waiting 3 days');
  assert.equal(applicationWaitingLabel({ submitted_at: '2026-10-23T14:00:00Z' }, now), 'Submitted today');
  assert.equal(applicationWaitingLabel(records[3], now), 'Submission date unavailable');
  assert.equal(applicationWaitingLabel({ submitted_at: '2026-10-24T14:00:00Z' }, now), 'Submission date unavailable');
});
