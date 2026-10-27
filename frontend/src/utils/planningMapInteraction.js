const validCoordinate = point => Array.isArray(point) && point.length >= 2
  && Number.isFinite(point[0]) && Number.isFinite(point[1]);

function inRing(point, ring) {
  if (!validCoordinate(point) || !Array.isArray(ring) || ring.length < 3 || !ring.every(validCoordinate)) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const dx = xj - xi, dy = yj - yi;
    const cross = (x - xi) * dy - (y - yi) * dx;
    // Include boundaries, but do not treat a ring's repeated endpoint as an
    // infinitely long segment (closed GeoJSON rings repeat the first point).
    if ((dx || dy) && Math.abs(cross) < 1e-12
      && x >= Math.min(xi, xj) && x <= Math.max(xi, xj)
      && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function containsPlanningCoordinate(geometry, coordinate) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return Array.isArray(polygons) && polygons.some(rings => Array.isArray(rings)
    && inRing(coordinate, rings[0]) && !rings.slice(1).some(hole => inRing(coordinate, hole)));
}

const segmentDistance = (point, start, end) => {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - amount * dx, point.y - start.y - amount * dy);
};

export function findPlanningMapTarget({ coordinate, point, sections, paths, project, pathTolerance = 22 }) {
  // Reverse draw order matches the visible saved boundary when it overlaps
  // a legacy polygon. Path proximity must never steal a click inside a section.
  const section = [...sections].reverse().find(item => {
    const props = item.properties || {};
    return props.is_active !== false && !props.is_retired && containsPlanningCoordinate(item.geometry, coordinate);
  });
  if (section) return { type: 'section', section };
  let nearest = null, nearestDistance = pathTolerance;
  for (const item of paths) {
    const geometry = item.feature.geometry;
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates]
      : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const coordinates of lines || []) {
      for (let index = 1; index < coordinates.length; index++) {
        if (!validCoordinate(coordinates[index - 1]) || !validCoordinate(coordinates[index])) continue;
        const distance = segmentDistance(point, project(coordinates[index - 1]), project(coordinates[index]));
        if (distance < nearestDistance) { nearest = item; nearestDistance = distance; }
      }
    }
  }
  return nearest ? { type: 'pathway', pathway: nearest } : null;
}
