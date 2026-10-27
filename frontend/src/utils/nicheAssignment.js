import { compareInventorySections } from './cpdoInventory.js';

// Use active inventory returned by the API. Exhaust each floor across the
// selected cemetery before proceeding to the next floor; lettered sections
// start at A, followed by custom section names, then numeric column order.
export function availableNichesInAssignmentOrder(slots, cemetery) {
  return slots.filter(slot => (slot.cemeteryMap || slot.cemetery_map) === cemetery
    && slot.status === 'available'
    && !String(slot.name || '').trim()
    && Number.isInteger(Number(slot.floor)) && Number(slot.floor) > 0
    && Number.isInteger(Number(slot.col)) && Number(slot.col) > 0)
    .sort((a, b) => Number(a.floor) - Number(b.floor)
      || compareInventorySections(a.section, b.section)
      || Number(a.col) - Number(b.col)
      || String(a.id).localeCompare(String(b.id)));
}
