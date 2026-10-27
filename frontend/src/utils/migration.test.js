import test from 'node:test';
import assert from 'node:assert/strict';
import { connectNearbyNodes } from './routeGraph.js';
import { filterApplications } from './applicationSearch.js';
import { requestRoutePosition } from './routeLocation.js';

function bruteForce(nodes, skipSamePath) {
  const entries = [...nodes];
  entries.forEach(([idA, a], i) => {
    entries.slice(i + 1).forEach(([idB, b]) => {
      if (skipSamePath && a.pathIndex === b.pathIndex) return;
      const dist = Math.hypot(a.coord[0] - b.coord[0], a.coord[1] - b.coord[1]);
      if (dist < 0.000035) {
        a.edges.push({ to: idB, dist });
        b.edges.push({ to: idA, dist });
      }
    });
  });
}

for (const skipSamePath of [false, true]) {
  test(`nearby graph preserves every edge and its order (same-path exclusion: ${skipSamePath})`, () => {
    let seed = 173;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const nodes = new Map(Array.from({ length: 250 }, (_, i) => [i, {
      coord: [(random() - .5) / 1000, (random() - .5) / 1000], pathIndex: i % 5, edges: [],
    }]));
    const reference = structuredClone(nodes);
    bruteForce(reference, skipSamePath);
    connectNearbyNodes(nodes, skipSamePath);
    assert.deepEqual(nodes, reference);
  });
}

test('graph handles duplicate, negative, cell boundary and exact radius coordinates', () => {
  const coords = [[0, 0], [0, 0], [.000035, 0], [-.000001, 0], [.0000349, 0], [-.000035, -.000035]];
  const nodes = new Map(coords.map((coord, i) => [i, { coord, pathIndex: i, edges: [] }]));
  const reference = structuredClone(nodes);
  bruteForce(reference, true);
  connectNearbyNodes(nodes, true);
  assert.deepEqual(nodes, reference);
  assert.doesNotThrow(() => connectNearbyNodes(new Map(), true));
});

test('application search matches applicant/deceased, accents, IDs and combined terms without modifying source', () => {
  const applications = [
    { application_id: 'BA-001', applicant_name: 'Jos\u00e9 Dela Cruz', deceased_name: 'Maria Cruz', applicant_contact_email: 'jose@example.test' },
    { application_id: 'BA-002', applicant_name: 'Ana Reyes', deceased_name: 'Pedro Santos' },
  ];
  assert.deepEqual(filterApplications(applications, ' JOSE   maria '), [applications[0]]);
  assert.deepEqual(filterApplications(applications, 'ba-002'), [applications[1]]);
  assert.deepEqual(filterApplications(applications, 'jose@example.test'), [applications[0]]);
  assert.deepEqual(filterApplications(applications, 'missing'), []);
  assert.equal(filterApplications(applications, '   '), applications);
  assert.equal(applications.length, 2);
});

test('location retries unavailable/timeout once with lower accuracy and keeps distant coordinates', () => {
  for (const code of [2, 3]) {
    const options = [];
    let result;
    requestRoutePosition(pos => { result = pos.coords; }, () => assert.fail('unexpected failure'), {
      secureContext: true,
      geolocation: { getCurrentPosition(success, error, option) {
        options.push(option);
        if (options.length === 1) error({ code });
        else success({ coords: { latitude: 14.6, longitude: 121 } });
      } },
    });
    assert.deepEqual(options.map(o => o.enableHighAccuracy), [true, false]);
    assert.deepEqual(result, { latitude: 14.6, longitude: 121 });
  }
});

test('permission denial does not retry, and aborted callbacks cannot resume navigation', () => {
  let calls = 0;
  requestRoutePosition(() => assert.fail(), error => assert.equal(error.code, 1), {
    geolocation: { getCurrentPosition(success, error) { calls++; error({ code: 1 }); } }, secureContext: true,
  });
  assert.equal(calls, 1);
  const controller = new AbortController();
  let success;
  requestRoutePosition(() => assert.fail('aborted success'), () => assert.fail('aborted failure'), {
    signal: controller.signal, secureContext: true, geolocation: { getCurrentPosition(callback) { success = callback; } },
  });
  controller.abort();
  success({ coords: { latitude: 13.9, longitude: 121.6 } });
});

test('location distinguishes insecure/unsupported and rejects invalid coordinates', () => {
  requestRoutePosition(() => assert.fail(), error => assert.equal(error.code, 'insecure'), { secureContext: false });
  requestRoutePosition(() => assert.fail(), error => assert.equal(error.code, 'unsupported'), { secureContext: true, geolocation: null });
  requestRoutePosition(() => assert.fail(), error => assert.equal(error.code, 2), {
    secureContext: true, geolocation: { getCurrentPosition(success) { success({ coords: { latitude: Infinity, longitude: 121 } }); } },
  });
});
