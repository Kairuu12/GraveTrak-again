import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPlanningSection, findSectionConflict, planningSectionSidebarId, planningSectionStatusCounts, resolvePlanningSections } from './planningSections.js';
import { activeInventoryForZones, buildInventory, filterInventory, inventorySections, inventoryTotals } from './cpdoInventory.js';

const polygon = name => ({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [] } });
const saved = (name, cemetery = 'old', extra = {}) => ({
  id: `${cemetery}:${name}`,
  properties: { name, cemetery_code: cemetery, status: 'active', is_active: true, ...extra },
});
const oldMap = [...'ABCDEFGHIJKLMN'].map(letter => polygon(`section ${letter}`));
const newMap = JSON.parse(readFileSync(new URL('../../anothermap.json', import.meta.url), 'utf8')).features;

test('permanently deleted Cluster 1 can be reused while live and archived records still reserve names', () => {
  const retired = saved('cluster 1', 'old', { is_retired: true, is_active: false });
  const active = saved('cluster 10');
  const query = { cemetery: 'old', name: ' Cluster 1 ' };
  assert.equal(findSectionConflict([retired, active], query), undefined);
  const archived = saved('CLUSTER 1', 'old', { is_active: false, zone_code: 'OLD-C1' });
  assert.equal(findSectionConflict([retired, archived], query), archived);
  assert.equal(findSectionConflict([archived], { cemetery: 'old', zoneCode: ' old-c1 ' }), archived);
  assert.equal(findSectionConflict([archived], { ...query, excludeId: archived.id }), undefined);
  assert.equal(findSectionConflict([archived], { ...query, cemetery: 'new' }), undefined);
  const recreated = saved('Cluster 1', 'old', { zone_code: 'OLD-C1' });
  assert.equal(findSectionConflict([retired, recreated], query), recreated);
  assert.equal(resolvePlanningSections([retired], [polygon('cluster 1')], 'old').length, 0);
  assert.equal(resolvePlanningSections([retired, recreated], [polygon('cluster 1')], 'old').length, 1);
});

test('five saved Old Cemetery sections plus existing map sections produce 18 active sections', () => {
  const database = ['another section d', 'new section NO NAME A', 'new section NO NAME B', 'new section NO NAME C', 'Section B'].map(name => saved(name));
  const sections = resolvePlanningSections(database, oldMap, 'old');
  assert.equal(sections.length, 18);
  assert.equal(sections.filter(section => section.isLegacySidebar).length, 13);
  assert.deepEqual(planningSectionStatusCounts(sections), { active: 18, planned: 0, maintenance: 0, unknown: 0 });
});

test('14 saved New Cemetery sections and the actual map produce 24 sections without duplicate B or R', () => {
  const database = [...'ABCDEFGHIJKLMN'].map(letter => saved(
    letter === 'B' ? 'New Section B' : `Section ${letter}`, 'new',
    letter === 'B' ? { legacy_source_name: 'Section B' } : {}
  ));
  const sections = resolvePlanningSections(database, newMap, 'new');
  assert.equal(sections.length, 24);
  assert.equal(sections.filter(section => section.isLegacySidebar).length, 10);
  assert.equal(sections.filter(section => section.properties.name === 'Section R').length, 1);
  assert.equal(sections.filter(section => section.properties.name === 'Section B').length, 0);
  assert.equal(sections.filter(section => section.properties.name === 'New Section B').length, 1);
  assert.deepEqual(planningSectionStatusCounts(sections), { active: 24, planned: 0, maintenance: 0, unknown: 0 });
});

test('maintenance and planned sections retain their saved statuses instead of using active map defaults', () => {
  const database = [
    saved('Renamed A', 'old', { legacy_source_name: 'Section A', status: 'maintenance' }),
    saved('Section B', 'old', { status: 'planned' }),
  ];
  const sections = resolvePlanningSections(database, oldMap, 'old');
  assert.equal(sections.length, 14);
  assert.deepEqual(planningSectionStatusCounts(sections), { active: 12, planned: 1, maintenance: 1, unknown: 0 });
  assert.equal(sections.filter(section => section.properties.name === 'Section A').length, 0);
});

test('archived and permanently deleted sections suppress fallback geometry and inventory', () => {
  const database = [
    saved('Renamed A', 'old', { legacy_source_name: 'Section A', is_active: false }),
    saved('Section B', 'old', { is_active: false, is_retired: true }),
  ];
  const sections = resolvePlanningSections(database, oldMap, 'old');
  assert.equal(sections.length, 12);
  const inventory = buildInventory([], ['Section A', 'Renamed A', 'Section B', 'Section C', 'orphan'].map(section => ({
    id: section, section, cemetery_map: 'old', floor: 1, col: 1,
  })));
  assert.deepEqual(activeInventoryForZones(inventory, sections, 'old').map(row => row.sectionName), ['Section C']);
  database[0].properties.is_active = true;
  assert.equal(resolvePlanningSections(database, oldMap, 'old').length, 13);
  assert.equal(resolvePlanningSections(database, newMap, 'new').length, 24);
});

test('explicitly recreated section supersedes retirement while aliases and non-section geometry are handled safely', () => {
  const database = [
    saved('Section A', 'old', { is_active: false, is_retired: true }),
    saved('Section A', 'old', { status: 'maintenance' }),
  ];
  const map = [polygon('A'), polygon('sec A'), polygon('Section A'), polygon('Expansion Area B'),
    { properties: { name: 'Pathway' }, geometry: { type: 'LineString' } }];
  const sections = resolvePlanningSections(database, map, 'old');
  assert.equal(sections.length, 2);
  assert.deepEqual(planningSectionStatusCounts(sections), { active: 1, planned: 0, maintenance: 1, unknown: 0 });
});

test('status summary excludes archived/deleted rows and does not mislabel unknown statuses as active', () => {
  assert.deepEqual(planningSectionStatusCounts([
    saved('A', 'old', { is_active: false }),
    saved('B', 'old', { is_retired: true }),
    saved('C', 'old', { status: 'unexpected' }),
  ]), { active: 0, planned: 0, maintenance: 0, unknown: 1 });
});

test('map clicks resolve legacy labels to the current Zones card after a rename', () => {
  const sections = resolvePlanningSections([
    saved('New Section B', 'new', { legacy_source_name: 'Section B' }),
  ], newMap, 'new');
  for (const label of ['B', 'section b', 'sec B', 'Expansion Area B', 'new section b']) {
    assert.equal(findPlanningSection(sections, label)?.properties.name, 'New Section B');
  }
  assert.equal(findPlanningSection(sections, 'Section X')?.properties.name, 'Section X');
  assert.equal(findPlanningSection(sections, 'missing'), undefined);
  assert.equal(findPlanningSection(sections, ''), undefined);
});

test('navigation uses a current name before a reused historical alias and excludes archived sections', () => {
  const sections = [
    saved('Renamed A', 'old', { legacy_source_name: 'A' }),
    saved('Section A'),
    saved('Section B', 'old', { is_active: false }),
    saved('Section C', 'old', { is_retired: true }),
  ];
  assert.equal(findPlanningSection(sections, 'A')?.properties.name, 'Section A');
  assert.equal(findPlanningSection(sections, 'Section B'), undefined);
  assert.equal(findPlanningSection(sections, 'Section C'), undefined);
});

test('sidebar element IDs distinguish cemeteries and punctuation while normalizing section aliases', () => {
  assert.equal(planningSectionSidebarId('sec a', 'old'), planningSectionSidebarId('Section A', 'old'));
  assert.notEqual(planningSectionSidebarId('Section A', 'old'), planningSectionSidebarId('Section A', 'new'));
  assert.notEqual(planningSectionSidebarId('Garden A', 'old'), planningSectionSidebarId('Garden-A', 'old'));
});

test('manager lists 24 New Cemetery sections while keeping unregistered O-X empty and inventory counts unchanged', () => {
  const names = [...'ABCDEFGHIJKLMN'].map(letter => letter === 'B' ? 'New Section B' : `Section ${letter}`);
  const database = names.map(name => saved(name, 'new', name === 'New Section B' ? { legacy_source_name: 'Section B' } : {}));
  const zones = resolvePlanningSections(database, newMap, 'new');
  const nicheData = names.flatMap(section => Array.from({ length: 496 }, (_, i) => ({
    id: `${section}:${i}`, section, cemetery_map: 'new', floor: Math.floor(i / 124) + 1, col: i % 124 + 1, status: 'available',
  })));
  const inventory = activeInventoryForZones(buildInventory([], nicheData), zones, 'new');
  const dropdown = inventorySections(inventory, zones, 'new');
  assert.equal(dropdown.length, 24);
  assert.equal(inventoryTotals(inventory).niche.total, 6944);
  for (const letter of 'OPQRSTUVWX') {
    assert.ok(dropdown.includes(`Section ${letter}`));
    assert.equal(filterInventory(inventory, { cemetery: 'new', section: `Section ${letter}`, kind: 'niche' }).length, 0);
  }
  assert.equal(filterInventory(inventory, { cemetery: 'new', section: 'New Section B', kind: 'niche', column: 1 }).length, 4);
  assert.equal(filterInventory(inventory, { cemetery: 'old', section: 'Section A', kind: 'niche' }).length, 0);
});
