import test from 'node:test';
import assert from 'node:assert/strict';
import { staffSearchResults } from './staffSearch.js';

const sections = ['old', 'new'].map(cemetery => ({ properties: { name: 'Section A', cemetery_code: cemetery, is_active: true } }));
const plots = [{ id: 7, plot_id: 'OLD-S001-R01-C01', legacy_plot_id: 'OLD-LEGACY', section_name: 'Section A', cemetery_code: 'old', status: 'available' }];
const slots = Array.from({ length: 40 }, (_, i) => ({ id: `N${i}`, section: 'Section A', cemeteryMap: 'old', name: i === 0 ? 'Maria Santos' : '', floor: 1, col: i + 1 }));

test('section search keeps direct section, plot and niche results with cemetery distinction', () => {
  const results = staffSearchResults('section a', slots, plots, sections);
  assert.deepEqual(results.slice(0, 2).map(row => row.cemeteryMap), ['old', 'new']);
  assert.equal(results.filter(row => row.kind === 'plot').length, 1);
  assert.equal(results.filter(row => row.kind === 'niche').length, 10);
  assert.equal(staffSearchResults('new section a', slots, plots, sections).length, 1);
});
test('names, plot IDs and legacy IDs resolve to the correct destination type', () => {
  assert.equal(staffSearchResults('santos maria', slots, plots, sections)[0].kind, 'niche');
  assert.equal(staffSearchResults('old-s001-r01-c01', slots, plots, sections)[0].plotId, 7);
  assert.equal(staffSearchResults('old-legacy', slots, plots, sections)[0].kind, 'plot');
  assert.deepEqual(staffSearchResults('   ', slots, plots, sections), []);
  assert.deepEqual(staffSearchResults('unmatched', slots, plots, sections), []);
});
test('archived and retired sections never appear as direct search results', () => {
  assert.deepEqual(staffSearchResults('removed', [], [], [
    { properties: { name: 'Removed A', is_active: false } },
    { properties: { name: 'Removed B', is_retired: true } },
  ]), []);
});
