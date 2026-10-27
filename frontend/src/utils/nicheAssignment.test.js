import test from 'node:test';
import assert from 'node:assert/strict';
import { availableNichesInAssignmentOrder } from './nicheAssignment.js';

const niche = (section, floor, col, extra = {}) => ({
  id: `${section}-${floor}-${col}`, section, floor, col,
  cemetery_map: 'old', status: 'available', ...extra,
});

test('Section A precedes custom section names, with numeric column ordering', () => {
  const rows = [niche('another section d', 1, 1), niche('Section B', 1, 1),
    niche('Section A', 1, 10), niche('Section A', 1, 9)];
  const original = [...rows];
  assert.deepEqual(availableNichesInAssignmentOrder(rows, 'old').map(s => s.id),
    ['Section A-1-9', 'Section A-1-10', 'Section B-1-1', 'another section d-1-1']);
  assert.deepEqual(rows, original);
});

test('all available Floor 1 slots precede Floor 2, even in later or custom sections', () => {
  const rows = [niche('Section A', 2, 1), niche('Section B', 1, 84),
    niche('another section d', 1, 1), niche('Section A', 3, 1)];
  const ordered = availableNichesInAssignmentOrder(rows, 'old');
  assert.deepEqual(ordered.map(s => s.floor), [1, 1, 2, 3]);
  assert.equal(availableNichesInAssignmentOrder(rows.filter(s => s.floor > 1), 'old')[0].floor, 2);
});

test('excludes other cemeteries, maintenance, occupied, named and invalid slots', () => {
  const rows = [niche('Section A', 1, 1, { cemetery_map: 'new' }),
    niche('Section A', 1, 2, { status: 'occupied' }),
    niche('Section A', 1, 3, { status: 'maintenance' }),
    niche('Section A', 1, 4, { name: 'Existing occupant' }),
    niche('Section A', 0, 5), niche('Section A', 1, 0),
    niche('sec a', '1', '6', { cemetery_map: undefined, cemeteryMap: 'old' })];
  assert.deepEqual(availableNichesInAssignmentOrder(rows, 'old').map(s => s.col), ['6']);
  assert.equal(availableNichesInAssignmentOrder(rows, 'new')[0].col, 1);
});

test('a newly unavailable preview is replaced by the next eligible position', () => {
  const rows = [niche('Section A', 1, 9), niche('Section A', 1, 10)];
  const preview = availableNichesInAssignmentOrder(rows, 'old')[0];
  const refreshed = rows.map(s => s.id === preview.id ? { ...s, status: 'occupied' } : s);
  assert.notEqual(availableNichesInAssignmentOrder(refreshed, 'old')[0].id, preview.id);
});
