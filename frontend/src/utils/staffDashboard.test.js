import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStaffInventory, SLOT_STATUSES } from './staffDashboard.js';

test('capacity counts individual slots without adding overlapping ground layouts', () => {
  const slots = Array.from({ length: 6192 }, (_, id) => ({ id, cemeteryMap: 'old', section: 'Section A', status: id < 9 ? 'occupied' : 'available' }));
  const plots = Array.from({ length: 456 }, () => ({ cemetery_code: 'old', status: 'available' }));
  const result = summarizeStaffInventory(slots, plots, 'old');
  assert.equal(result.totals.total, 6192);
  assert.equal(result.totals.available, 6183);
  assert.equal(result.layouts.total, 456);
  assert.equal(result.occupied.length, 9);
});
test('scope, unknown statuses and separate maintenance queues reconcile', () => {
  const result = summarizeStaffInventory([
    { cemetery_map: 'new', section: 'A', status: 'maintenance' },
    { cemeteryMap: 'new', section: 'Section A', status: 'reserved' },
    { cemeteryMap: 'new', section: 'Section B', status: 'unrecognized' },
    { cemeteryMap: 'old', section: 'A', status: 'occupied' },
  ], [{ cemetery_code: 'new', status: 'maintenance' }, { cemetery_code: 'old', status: 'maintenance' }], 'new');
  assert.equal(result.sections.length, 2);
  assert.equal(result.totals.total, 3);
  assert.equal(SLOT_STATUSES.reduce((sum, status) => sum + result.totals[status], 0), result.totals.total);
  assert.equal(result.maintenance.length, 1);
  assert.equal(result.layoutMaintenance.length, 1);
  assert.equal(result.totals.other, 1);
});
test('empty data has zero occupancy and no invented capacity', () => {
  const result = summarizeStaffInventory([], [], 'old');
  assert.equal(result.occupancy, 0);
  assert.equal(result.totals.total, 0);
  assert.deepEqual(result.sections, []);
});
test('section charts begin with lettered sections before custom sections', () => {
  const result = summarizeStaffInventory(['another section d', 'Section B', 'Section A'].map(section => ({ section, status: 'available' })), [], 'old');
  assert.deepEqual(result.sections.map(row => row.name), ['Section A', 'Section B', 'another section d']);
});
