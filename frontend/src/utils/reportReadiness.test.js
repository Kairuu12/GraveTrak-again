import test from 'node:test';
import assert from 'node:assert/strict';
import { isReportReady } from './reportReadiness.js';
const overall = { period: 'overall', from: '1900-01-01', to: '2026-10-23' };
const custom = { period: 'custom', from: '2026-10-01', to: '2026-10-23' };
test('generated Overall report is ready with blank calendar inputs', () => {
  assert.equal(isReportReady(overall), true);
});
test('edited dates require generation before submitting or exporting', () => {
  assert.equal(isReportReady(overall, { from: custom.from, to: custom.to }), false);
  assert.equal(isReportReady(custom), false);
  assert.equal(isReportReady(custom, { from: custom.from }), false);
  assert.equal(isReportReady(custom, { from: custom.from, to: '2026-10-22' }), false);
  assert.equal(isReportReady(custom, { from: custom.from, to: custom.to }), true);
});
test('missing, loading and failed reports cannot be submitted', () => {
  assert.equal(isReportReady(null), false);
  assert.equal(isReportReady(overall, { loading: true }), false);
  assert.equal(isReportReady(overall, { error: 'Request failed' }), false);
});
