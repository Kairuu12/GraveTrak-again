import { performance } from 'node:perf_hooks';
import { buildInventory, buildStackInventory, inventorySectionTotals, filterInventory } from '../src/utils/cpdoInventory.js';

// Synthetic records at the audited inventory size; no personal data needed.
const niches = Array.from({ length: 13136 }, (_, i) => ({
  id: `n${i}`, cemetery_map: i < 6192 ? 'old' : 'new',
  section: `Section ${Math.floor(i / 400) + 1}`, floor: i % 4 + 1,
  col: Math.floor(i % 400 / 4) + 1, status: i % 997 ? 'available' : 'occupied',
}));
const plots = Array.from({ length: 2192 }, (_, i) => ({
  id: i, cemetery_code: i < 456 ? 'old' : 'new',
  section_name: `Section ${Math.floor(i / 96) + 1}`, plot_number: i,
  plot_id: `P${i}`, status: 'available',
}));
const samples = [];
for (let run = 0; run < 8; run++) {
  const start = performance.now();
  const rows = buildInventory(plots, niches);
  const stacks = buildStackInventory(rows);
  inventorySectionTotals(rows, []);
  filterInventory(rows, { cemetery: 'old' });
  if (rows.length !== 15328 || stacks.length !== 3284) throw new Error('Fixture totals changed');
  if (run > 0) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ records: 15328, medianMs: Number(samples[3].toFixed(2)), samplesMs: samples.map(ms => Number(ms.toFixed(2))) }));
