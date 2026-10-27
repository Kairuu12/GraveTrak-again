import test from 'node:test';
import assert from 'node:assert/strict';
import { getSectionLayout, getNichePosition } from './sectionLayout.js';
import { buildSavedSectionPlotFeatures } from './savedSectionLayout.js';

test('explicit single-row dimensions override legacy even-count assumptions', () => {
  const layout = getSectionLayout({ properties: { layout_rows: 1, layout_columns: 84 } });
  assert.deepEqual(getNichePosition({ col: 84, cemeteryMap: 'old' }, layout), { side: 'Front', column: 84 });
  assert.deepEqual(getNichePosition({ col: 13 }, { rows: 2, columns: 12 }), { side: 'Back', column: 1 });
  assert.equal(getSectionLayout({}, []), null);
  assert.deepEqual(getSectionLayout({}, [{ plot_id: 'OLD-S001-R02-C42' }]), { rows: 2, columns: 42 });
});

test('single row renders twelve cells and each maps to its matching niche column', () => {
  const section = { id: 1, properties: { layout_rows: 1, layout_columns: 12 },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[12,0],[12,1],[0,1],[0,0]]] } };
  const plots = Array.from({ length: 12 }, (_, i) => ({ section_record: 1, plot_id: `OLD-S001-R01-C${i+1}` }));
  const features = buildSavedSectionPlotFeatures([section], plots).features;
  assert.equal(features.length, 12);
  assert.deepEqual(features.map(f => f.properties.niche_column), Array.from({ length: 12 }, (_, i) => i+1));
  assert.ok(features.every(f => f.properties.row === 1));
  // Missing/clipped cells must not stretch the remaining cells across the grid.
  assert.deepEqual(buildSavedSectionPlotFeatures([section], plots.slice(0, 4)).features[3].geometry, features[3].geometry);
});
