import { compareInventorySections } from './cpdoInventory.js';

export const SLOT_STATUSES = ['available', 'occupied', 'reserved', 'maintenance', 'other'];
const emptyCounts = () => ({ total: 0, available: 0, occupied: 0, reserved: 0, maintenance: 0, other: 0 });
const sectionKey = name => String(name).trim().toLowerCase().replace(/^(?:sec(?:tion)?\s*)?([a-z])$/, 'section $1');
const recordCemetery = row => row.cemeteryMap || row.cemetery_map || row.cemetery_code || row.cemetery?.code || 'old';
const count = (totals, status) => { totals.total++; totals[SLOT_STATUSES.includes(status) ? status : 'other']++; };

export function summarizeStaffInventory(slots, plots, cemetery) {
  const totals = emptyCounts();
  const layouts = emptyCounts();
  const sections = new Map();
  const occupied = [];
  const maintenance = [];
  const layoutMaintenance = [];
  for (const slot of slots) {
    if (recordCemetery(slot) !== cemetery) continue;
    const status = String(slot.status || '').toLowerCase();
    count(totals, status);
    const name = slot.section || 'Unspecified section';
    const key = sectionKey(name);
    if (!sections.has(key)) sections.set(key, { name, ...emptyCounts() });
    count(sections.get(key), status);
    if (status === 'occupied') occupied.push(slot);
    if (status === 'maintenance') maintenance.push(slot);
  }
  for (const plot of plots) {
    if (recordCemetery(plot) !== cemetery) continue;
    const status = String(plot.status || '').toLowerCase();
    count(layouts, status);
    if (status === 'maintenance') layoutMaintenance.push(plot);
  }
  return { totals, layouts, occupied, maintenance, layoutMaintenance,
    sections: [...sections.values()].sort((a, b) => compareInventorySections(a.name, b.name)),
    occupancy: totals.total ? totals.occupied / totals.total * 100 : 0,
  };
}
