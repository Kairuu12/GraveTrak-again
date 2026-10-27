import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSavedSectionPlotFeatures, legacyTwoSidedCorners } from './savedSectionLayout.js';

test('saved original map cells keep both sides and their niche column mapping', () => {
  const vertices = [[0, 2], [42, 2], [42, 0], [0, 0]];
  const section = { id: 1, properties: { name: 'Section A', cemetery_code: 'old' },
    geometry: { type: 'Polygon', coordinates: [[...vertices, vertices[0]]], plot_layout: 'legacy-two-sided' } };
  const plots = [1, 2].flatMap(row => Array.from({ length: 42 }, (_, index) => ({
    id: (row - 1) * 42 + index + 1, section_record: 1, plot_id: `OLD-S001-R${row}-C${index + 1}`,
    status: 'available',
  })));
  const cells = buildSavedSectionPlotFeatures([section], plots).features;
  assert.equal(cells.length, 84);
  assert.deepEqual(cells[0].geometry.coordinates[0], [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  assert.deepEqual(cells[42].geometry.coordinates[0], [[0, 1], [1, 1], [1, 2], [0, 2], [0, 1]]);
  assert.equal(cells[42].properties.niche_column, 43);
  assert.deepEqual(cells[42].properties.rendered_center, [1.5, .5]);
  assert.deepEqual(legacyTwoSidedCorners(vertices, 2, 42), [[41, 1], [42, 1], [42, 2], [41, 2]]);
  section.properties.is_active = false;
  assert.equal(buildSavedSectionPlotFeatures([section], plots).features.length, 0);
});

test('ordinary saved layouts do not invent a niche-column assignment', () => {
  const section = { id: 2, properties: {}, geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] } };
  const result = buildSavedSectionPlotFeatures([section], [{ section_record: 2, plot_id: 'OLD-S002-R01-C01', status: 'occupied' }]);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.status, 'occupied');
  assert.equal(result.features[0].properties.niche_column, null);
});
