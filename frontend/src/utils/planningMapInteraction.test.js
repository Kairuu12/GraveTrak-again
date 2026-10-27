import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containsPlanningCoordinate, findPlanningMapTarget } from './planningMapInteraction.js';
import { findPlanningSection, resolvePlanningSections } from './planningSections.js';

const square = { type: 'Feature', properties: { name: 'Section A' }, geometry: {
  type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
} };
const path = { key: 'path-1', feature: { geometry: { type: 'LineString', coordinates: [[-10, -1], [20, -1]] } } };
const project = ([x, y]) => ({ x, y });
const hit = (coordinate, sections = [square], paths = [path]) => findPlanningMapTarget({
  coordinate, point: project(coordinate), project, sections, paths,
});

test('click inside a section wins over the 22-pixel pathway capture halo', () => {
  assert.equal(hit([5, 1]).type, 'section');
  assert.equal(hit([5, 1]).section.properties.name, 'Section A');
  assert.equal(hit([5, 5]).type, 'section');
  assert.equal(hit([5, 0]).type, 'section');
});

test('pathway and empty-map clicks still resolve correctly outside section boundaries', () => {
  assert.equal(hit([5, -1]).type, 'pathway');
  assert.equal(hit([5, -1]).pathway.key, 'path-1');
  assert.equal(hit([100, 100]), null);
});

test('saved overlays win over legacy polygons; archived/deleted areas are not selected', () => {
  const saved = { ...square, properties: { name: 'Renamed section', cemetery_code: 'old' } };
  assert.equal(hit([5, 5], [square, saved]).section, saved);
  assert.equal(hit([5, 5], [{ ...saved, properties: { ...saved.properties, is_active: false } }], []), null);
  assert.equal(hit([5, 5], [{ ...saved, properties: { ...saved.properties, is_retired: true } }], []), null);
});

test('polygon holes, closed rings and multipolygons do not capture unrelated map clicks', () => {
  const geometry = { ...square.geometry, coordinates: [...square.geometry.coordinates,
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ] };
  assert.equal(containsPlanningCoordinate(geometry, [5, 5]), false);
  assert.equal(containsPlanningCoordinate(geometry, [1, 1]), true);
  assert.equal(containsPlanningCoordinate(square.geometry, [100, 100]), false);
  assert.equal(containsPlanningCoordinate({ type: 'MultiPolygon', coordinates: [geometry.coordinates] }, [1, 1]), true);
  assert.equal(containsPlanningCoordinate({ type: 'Polygon', coordinates: [] }, [1, 1]), false);
});

test('actual Old Cemetery polygon remains selectable next to a pathway', () => {
  const ring = [[121.6203214791338, 13.93855488284199], [121.6205836356741, 13.93870262747862],
    [121.6205599091991, 13.93874216581273], [121.6202991675655, 13.93860249552575], [121.6203214791338, 13.93855488284199]];
  const section = { properties: { name: 'section A', cemetery_code: 'old' }, geometry: { type: 'Polygon', coordinates: [ring] } };
  const coordinate = [0, 1].map(axis => ring.slice(0, 4).reduce((sum, vertex) => sum + vertex[axis], 0) / 4);
  const screen = ([x, y]) => ({ x: x * 100000, y: y * 100000 });
  const edgePath = { key: 'adjacent-road', feature: { geometry: { type: 'LineString', coordinates: [ring[0], ring[1]] } } };
  const result = findPlanningMapTarget({ coordinate, point: screen(coordinate), project: screen, sections: [section], paths: [edgePath] });
  assert.equal(result.type, 'section');
  assert.equal(result.section.properties.cemetery_code, 'old');
});

test('actual New Cemetery polygon click resolves to the renamed Zones card', () => {
  const features = JSON.parse(readFileSync(new URL('../../anothermap.json', import.meta.url), 'utf8')).features;
  const original = features.find(feature => feature.geometry?.type === 'Polygon' && feature.properties.name.toLowerCase() === 'section b');
  const ring = original.geometry.coordinates[0];
  const vertices = ring.slice(0, -1);
  const coordinate = [0, 1].map(axis => vertices.reduce((sum, vertex) => sum + vertex[axis], 0) / vertices.length);
  const result = hit(coordinate, [original], []);
  assert.equal(result.type, 'section');
  const catalogue = resolvePlanningSections([{
    id: 1, properties: { name: 'New Section B', legacy_source_name: 'Section B', cemetery_code: 'new', is_active: true },
  }], features, 'new');
  assert.equal(findPlanningSection(catalogue, result.section.properties.name).properties.name, 'New Section B');
});
