// Inspect nearby grid cells instead of comparing every pair of nodes.
// Preserve insertion order so equal-distance route choices remain unchanged.
export function connectNearbyNodes(nodes, skipSamePath = false, radius = 0.000035) {
  const cells = new Map();
  const entries = Array.from(nodes, ([id, node], index) => ({
    id, node, index, x: Math.floor(node.coord[0] / radius), y: Math.floor(node.coord[1] / radius),
  }));
  for (const entry of entries) {
    const key = `${entry.x},${entry.y}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
  }
  for (const a of entries) {
    const candidates = [];
    for (let x = a.x - 1; x <= a.x + 1; x++) {
      for (let y = a.y - 1; y <= a.y + 1; y++) {
        for (const b of cells.get(`${x},${y}`) || []) {
          if (b.index > a.index && (!skipSamePath || a.node.pathIndex !== b.node.pathIndex)) candidates.push(b);
        }
      }
    }
    candidates.sort((a, b) => a.index - b.index);
    for (const b of candidates) {
      const dist = Math.hypot(a.node.coord[0] - b.node.coord[0], a.node.coord[1] - b.node.coord[1]);
      if (dist < radius) {
        a.node.edges.push({ to: b.id, dist });
        b.node.edges.push({ to: a.id, dist });
      }
    }
  }
}
