import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBoundaryFeatures, buildPathwayJoinFeatures } from './mapGeometry.js';
import { siteData } from '../data/cemeteryLayout.js';

const line = coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });

test('keeps the aligned Old Cemetery ring closed without moving a vertex or plot', () => {
  const original = JSON.stringify(siteData);
  const repaired = closeBoundaryFeatures(siteData);
  const before = siteData.features[0].geometry.coordinates;
  const after = repaired.features[0].geometry.coordinates;
  assert.deepEqual(after.at(-1), before[0]);
  assert.deepEqual(after, before);
  assert.deepEqual(after[0], [121.6199905, 13.9390239]);
  assert.deepEqual(after.at(-2), [121.6208461, 13.9373969]);
  assert.deepEqual(repaired.features.slice(1), siteData.features.slice(1));
  assert.equal(JSON.stringify(siteData), original);
  assert.deepEqual(closeBoundaryFeatures(repaired), repaired);
});

test('still closes small digitization gaps in legacy boundary data', () => {
  const feature = line([[0,0], [0.001,0], [0.001,0.001], [0,0.00001]]);
  feature.properties.type = 'boundary';
  const result = closeBoundaryFeatures({ features: [feature] });
  assert.deepEqual(result.features[0].geometry.coordinates, [...feature.geometry.coordinates, [0,0]]);
});

test('does not close routes or large intentional openings', () => {
  const route = line([[0,0], [1,0], [1,1], [0,0.00001]]);
  const boundary = { ...route, properties: { type: 'boundary' } };
  boundary.geometry = { type: 'LineString', coordinates: [[0,0], [1,0], [1,1], [0,0.001]] };
  const collection = { type: 'FeatureCollection', features: [route, boundary] };
  assert.deepEqual(closeBoundaryFeatures(collection), collection);
});

test('joins a digitization gap at a T junction without shifting the source geometry', () => {
  const lines = [line([[0,0], [0.001,0]]), line([[0.0005,0.000002], [0.0005,0.001]])];
  const before = JSON.stringify(lines);
  const joins = buildPathwayJoinFeatures(lines).features;
  assert.equal(joins.length, 1);
  assert.deepEqual(joins[0].geometry.coordinates, [[0.0005,0.000002], [0.0005,0]]);
  assert.equal(JSON.stringify(lines), before);
});

test('keeps existing connections and gaps larger than 35 cm untouched', () => {
  assert.equal(buildPathwayJoinFeatures([line([[0,0], [0.001,0]]), line([[0.0005,0], [0.0005,0.001]])]).features.length, 0);
  assert.equal(buildPathwayJoinFeatures([line([[0,0], [0.001,0]]), line([[0.0005,0.00002], [0.0005,0.001]])]).features.length, 0);
});
