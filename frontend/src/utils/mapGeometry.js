// Display-only repairs: retain surveyed vertices and never stretch plot cells.
export function closeBoundaryFeatures(collection, toleranceMeters = 2) {
  return { ...collection, features: collection.features.map(feature => {
    const boundary = feature.properties?.type === 'boundary' || feature.properties?.name === 'boundary';
    const points = feature.geometry?.coordinates;
    if (!boundary || feature.geometry?.type !== 'LineString' || points.length < 4) return feature;
    const gap = distanceMeters(points[0], points.at(-1));
    if (!gap || gap > toleranceMeters) return feature;
    return { ...feature, geometry: { ...feature.geometry, coordinates: [...points, [...points[0]]] } };
  }) };
}

function distanceMeters(a, b) {
  const scale = Math.cos((a[1] + b[1]) * Math.PI / 360);
  return Math.hypot((a[0] - b[0]) * 111320 * scale, (a[1] - b[1]) * 110540);
}

// Join digitization slivers only. Larger gaps may be intentional entrances.
// Project endpoints onto segments as well as endpoints to include T junctions.
export function buildPathwayJoinFeatures(features, toleranceMeters = 0.35) {
  const lines = features.filter(feature => feature.geometry?.type === 'LineString');
  const joins = [];
  const seen = new Set();
  lines.forEach((feature, index) => {
    const points = feature.geometry.coordinates;
    if (points.length < 2) return;
    for (const endpoint of [points[0], points.at(-1)]) {
      let nearest = null, best = toleranceMeters;
      const scale = Math.cos(endpoint[1] * Math.PI / 180);
      lines.forEach((other, otherIndex) => {
        if (index === otherIndex) return;
        const coordinates = other.geometry.coordinates;
        for (let i = 1; i < coordinates.length; i++) {
          const a = coordinates[i - 1], b = coordinates[i];
          const dx = (b[0] - a[0]) * scale, dy = b[1] - a[1];
          const lengthSquared = dx * dx + dy * dy;
          if (!lengthSquared) continue;
          const t = Math.max(0, Math.min(1, (((endpoint[0] - a[0]) * scale * dx) + (endpoint[1] - a[1]) * dy) / lengthSquared));
          const projected = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
          const distance = distanceMeters(endpoint, projected);
          if (distance < best) { best = distance; nearest = projected; }
        }
      });
      if (!nearest || best < 0.001) continue;
      const key = [endpoint.join(','), nearest.join(',')].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      joins.push({ type: 'Feature', properties: { pathway_join: true },
        geometry: { type: 'LineString', coordinates: [[...endpoint], nearest] } });
    }
  });
  return { type: 'FeatureCollection', features: joins };
}
