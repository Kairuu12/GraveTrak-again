import test from 'node:test';
import assert from 'node:assert/strict';
import { activeInventoryForZones, buildInventory, buildStackInventory, filterInventory, inventorySections, inventoryCsv, inventoryTotals, inventorySectionTotals } from './cpdoInventory.js';

test('natural section ordering and count-only stack totals preserve cemetery and alias boundaries', () => {
  const inventory = buildInventory([], [
    { id: 1, cemetery_map: 'old', section: 'Section 10', col: 1, floor: 1, status: 'available' },
    { id: 2, cemetery_map: 'old', section: 'Section 2', col: 1, floor: 1, status: 'available' },
    { id: 3, cemetery_map: 'old', section: 'A', col: 1, floor: 1, status: 'occupied' },
    { id: 4, cemetery_map: 'old', section: 'Section A', col: 1, floor: 3, status: 'available' },
    { id: 5, cemetery_map: 'new', section: 'Section A', col: 1, floor: 1, status: 'maintenance' },
  ]);
  const totals = inventorySectionTotals(inventory, ['Section 2', 'Section 10', 'Section A', 'Empty']);
  assert.deepEqual(totals.map(row => row.name), ['Section A', 'Empty', 'Section 2', 'Section 10']);
  assert.equal(totals.find(row => row.name === 'Section A').stacks, 2);
  assert.equal(totals.reduce((sum, row) => sum + row.stacks, 0), buildStackInventory(inventory).length);
  assert.deepEqual(filterInventory(inventory, { cemetery: 'old', search: '   ' }), inventory.filter(row => row.cemeteryCode === 'old'));
  assert.deepEqual(inventorySections(inventory, [], 'old'), ['A', 'Section 2', 'Section 10']);
});

const rows = buildInventory([
  { id: 7, plot_id: 'OLD-S009-R01-C01', legacy_plot_id: 'OLD-LOLOL-R01-C01', cemetery_code: 'old', section_name: 'Garden A', plot_number: 1, status: 'available' },
], [
  { id: 'OLD-SECTION-C-F1-C1', cemetery_map: 'old', section: 'Section C', floor: 1, col: 1, status: 'maintenance' },
  { id: 'NEW-SECTION-C-F1-C1', cemetery_map: 'new', section: 'Section C', floor: 1, col: 1, status: 'occupied', name: 'Example occupant' },
]);

test('lettered sections precede custom names in plot, niche, stack and section lists', () => {
  const names = ['another section d', 'Section C', 'sec b', 'Section A', 'new section NO NAME A'];
  const niches = names.map((section, id) => ({ id, section, floor: 1, col: 1, cemetery_map: 'old' }));
  const plots = names.map((section_name, id) => ({ id, section_name, plot_number: 1, cemetery_code: 'old' }));
  const inventory = buildInventory(plots, niches);
  const expected = ['Section A', 'sec b', 'Section C', 'another section d', 'new section NO NAME A'];
  for (const kind of ['ground', 'niche']) {
    assert.deepEqual(inventory.filter(row => row.kind === kind).map(row => row.sectionName), expected);
  }
  assert.deepEqual(buildStackInventory(inventory).map(row => row.sectionName), expected);
  assert.deepEqual(inventorySections(inventory, [], 'old'), expected);
});

test('inactive, deleted, and orphaned sections cannot enter active records, counts or exports', () => {
  const inventory = buildInventory([], [
    { id: 'a', section: 'Active Garden', cemetery_map: 'old', floor: 1, col: 1 },
    { id: 'b', section: 'Archived Garden', cemetery_map: 'old', floor: 1, col: 1 },
    { id: 'c', section: 'another practice', cemetery_map: 'old', floor: 1, col: 1 },
    { id: 'd', section: 'Section D', cemetery_map: 'old', floor: 1, col: 1 },
  ]);
  const zones = [
    { properties: { name: 'Active Garden', cemetery_code: 'old', is_active: true } },
    { properties: { name: 'Archived Garden', cemetery_code: 'old', is_active: false } },
    { properties: { name: 'Section D', cemetery_code: 'old', is_active: false, is_retired: true } },
  ];
  const visible = activeInventoryForZones(inventory, zones, 'old');
  assert.deepEqual(visible.map(row => row.id), ['a']);
  assert.deepEqual(inventorySections(visible, zones, 'old'), ['Active Garden']);
  assert.ok(!inventoryCsv(visible).includes('another practice'));
});

test('valid legacy niche-only sections remain visible through normalized section names', () => {
  const inventory = buildInventory([], [{ id: 'a', section: 'A', cemetery_map: 'old', floor: 1, col: 1 }]);
  const zones = [{ properties: { name: 'Section A', cemetery_code: 'old' } }];
  assert.equal(activeInventoryForZones(inventory, zones, 'old').length, 1);
  assert.equal(activeInventoryForZones(inventory, zones, 'new').length, 0);
});

test('niche-only sections appear alongside ground sections and remain cemetery scoped', () => {
  assert.deepEqual(inventorySections(rows, [], 'old'), ['Section C', 'Garden A']);
  assert.equal(filterInventory(rows, { cemetery: 'old', section: 'Section C' }).length, 1);
  assert.equal(filterInventory(rows, { cemetery: 'old', section: 'Section C', kind: 'ground' }).length, 0);
  assert.equal(filterInventory(rows, { cemetery: 'new' }).length, 1);
});

test('mapped sections without inventory remain selectable without invented records', () => {
  const zones = [{ properties: { cemetery_code: 'old', name: 'Section D' } }];
  assert.ok(inventorySections(rows, zones, 'old').includes('Section D'));
  assert.equal(filterInventory(rows, { cemetery: 'old', section: 'Section D' }).length, 0);
});

test('professional references and readable positions retain legacy search compatibility', () => {
  const result = filterInventory(rows, { cemetery: 'old', search: 'old-lolol' });
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'OLD-S009-R01-C01');
  assert.equal(result[0].positionLabel, 'Row 1, Column 1');
  const niche = filterInventory(rows, { cemetery: 'old', kind: 'niche', status: 'maintenance' })[0];
  assert.equal(niche.label, 'Niche F01-C01');
  assert.equal(niche.id, 'OLD-SECTION-C-F1-C1');
});

test('CSV exports only supplied filtered inventory and escapes spreadsheet formulas', () => {
  const filtered = filterInventory(rows, { cemetery: 'old', kind: 'ground' });
  const csv = inventoryCsv(filtered);
  assert.ok(csv.includes('OLD-S009-R01-C01'));
  assert.ok(!csv.includes('LOLOL'));
  assert.ok(!csv.includes('Apartment niche'));
  assert.ok(inventoryCsv([{ ...filtered[0], sectionName: '=HYPERLINK("test")' }]).includes("'=HYPERLINK"));
});

test('niche availability never includes ground plot availability', () => {
  const inventory = [
    ...Array.from({ length: 456 }, () => ({ kind: 'ground', status: 'available' })),
    ...Array.from({ length: 6192 }, (_, index) => ({ kind: 'niche', status: index < 9 ? 'occupied' : 'available' })),
  ];
  assert.deepEqual(inventoryTotals(inventory), {
    ground: { total: 456, available: 456, occupied: 0, maintenance: 0 },
    niche: { total: 6192, available: 6183, occupied: 9, maintenance: 0 },
  });
  inventory[456 + 9].status = 'maintenance';
  const totals = inventoryTotals(inventory);
  assert.equal(totals.niche.available, 6182);
  assert.equal(totals.niche.maintenance, 1);
  assert.equal(totals.niche.total, totals.niche.available + totals.niche.occupied + totals.niche.maintenance);
  assert.equal(totals.ground.available, 456);
});

test('section breakdown reconciles with cemetery totals and retains empty mapped sections', () => {
  const visible = filterInventory(rows, { cemetery: 'old' });
  const breakdown = inventorySectionTotals(visible, ['Garden A', 'Section C', 'Empty section']);
  for (const kind of ['ground', 'niche']) {
    for (const field of ['total', 'available', 'occupied', 'maintenance']) {
      assert.equal(breakdown.reduce((sum, section) => sum + section[kind][field], 0), inventoryTotals(visible)[kind][field]);
    }
  }
  assert.equal(breakdown.find(section => section.name === 'Empty section').niche.total, 0);
  assert.equal(breakdown.find(section => section.name === 'Section C').niche.maintenance, 1);
  assert.equal(inventoryTotals([]).ground.total, 0);
});

test('section counts and section filters use the same canonical legacy section names', () => {
  const inventory = buildInventory([], [
    { id: 'a', cemetery_map: 'old', section: 'A', floor: 1, col: 1, status: 'available' },
    { id: 'b', cemetery_map: 'old', section: 'Section A', floor: 1, col: 2, status: 'occupied' },
  ]);
  const zones = [{ properties: { name: 'Section A', cemetery_code: 'old' } }];
  const names = inventorySections(inventory, zones, 'old');
  assert.deepEqual(names, ['Section A']);
  const breakdown = inventorySectionTotals(inventory, names);
  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].niche.total, 2);
  assert.equal(filterInventory(inventory, { cemetery: 'old', section: breakdown[0].name }).length, 2);
});

test('all 18 Old Cemetery sections contribute 1548 stack positions and 6192 niches regardless of saved ground layouts', () => {
  const sections = [
    ...Array.from({ length: 14 }, (_, i) => ({ name: `Section ${String.fromCharCode(65 + i)}`, columns: 84 })),
    { name: 'another section d', columns: 84 },
    ...['A', 'B', 'C'].map(letter => ({ name: `new section NO NAME ${letter}`, columns: 96 })),
  ];
  const niches = sections.flatMap(({ name, columns }) => Array.from({ length: columns * 4 }, (_, i) => ({
    id: `${name}:${i}`, section: name, col: i % columns + 1, floor: Math.floor(i / columns) + 1,
    cemetery_map: 'old', status: 'available',
  })));
  const inventory = buildInventory([], niches);
  const stacks = buildStackInventory(inventory);
  assert.equal(stacks.length, 1548);
  assert.equal(stacks.reduce((sum, stack) => sum + stack.counts.total, 0), 6192);
  assert.ok(stacks.every(stack => stack.counts.total === 4));
  assert.equal(inventorySectionTotals(inventory, sections.map(section => section.name)).reduce((sum, section) => sum + section.stacks, 0), 1548);
  assert.equal(buildStackInventory(buildInventory([{ id: 1, section_name: 'Section B', plot_id: 'OLD-S001-R01-C01' }], niches)).length, 1548);
});

test('stacks count actual positions with variable floors and gaps; cemetery, section and column remain distinct', () => {
  const inventory = buildInventory([], [
    { id: 1, cemetery_map: 'old', section: 'Section A', col: 1, floor: 1, status: 'occupied' },
    { id: 2, cemetery_map: 'old', section: 'A', col: 1, floor: 3, status: 'available' },
    { id: 3, cemetery_map: 'old', section: 'Section A', col: 7, floor: 1, status: 'maintenance' },
    { id: 4, cemetery_map: 'new', section: 'Section A', col: 1, floor: 1, status: 'available' },
    { id: 5, cemetery_map: 'old', section: 'Section B', col: 1, floor: 1, status: 'occupied' },
  ]);
  const stacks = buildStackInventory(inventory);
  assert.equal(stacks.length, 4);
  const oldA = stacks.find(stack => stack.cemeteryCode === 'old' && stack.col === 1 && stack.counts.total === 2);
  assert.deepEqual(oldA.floors, [1, 3]);
  assert.equal(oldA.status, 'partial');
  assert.equal(stacks.find(stack => stack.col === 7).status, 'maintenance');
  assert.equal(stacks.find(stack => stack.sectionName === 'Section B').status, 'occupied');
  assert.equal(stacks.find(stack => stack.cemeteryCode === 'new').status, 'available');
  // The action from a stack must open only that stack's individual niches.
  assert.deepEqual(filterInventory(inventory, { cemetery: 'old', section: 'Section A', kind: 'niche', column: '1' }).map(row => row.id).sort(), [1, 2]);
  assert.equal(buildStackInventory([]).length, 0);
});

test('archiving a section removes its stacks and niches together from active capacity', () => {
  const inventory = buildInventory([], [
    { id: 'a', section: 'Section A', cemetery_map: 'old', floor: 1, col: 1, status: 'available' },
    { id: 'b', section: 'Section B', cemetery_map: 'old', floor: 1, col: 1, status: 'available' },
    { id: 'c', section: 'orphan', cemetery_map: 'old', floor: 1, col: 1, status: 'available' },
  ]);
  const zones = [
    { properties: { name: 'Section A', cemetery_code: 'old', is_active: true } },
    { properties: { name: 'Section B', cemetery_code: 'old', is_active: false } },
  ];
  const stacks = buildStackInventory(activeInventoryForZones(inventory, zones, 'old'));
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].sectionName, 'Section A');
  assert.ok(inventoryCsv(stacks).includes('Stack position'));
  assert.ok(!inventoryCsv(stacks).includes('orphan'));
});
