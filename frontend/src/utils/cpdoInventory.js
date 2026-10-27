export const normalizeInventoryText = value => String(value || '').trim().toLowerCase();
const pad = value => String(value).padStart(2, '0');
// Reuse the collator instead of constructing one for every sort comparison.
const naturalCompare = new Intl.Collator(undefined, { numeric: true }).compare;
const sectionKey = value => {
  const name = normalizeInventoryText(value);
  const letter = name.match(/^(?:sec(?:tion)?\s*)?([a-z])$/);
  return letter ? `section ${letter[1]}` : name;
};

export function compareInventorySections(a, b) {
  const left = sectionKey(a);
  const right = sectionKey(b);
  const leftLetter = /^section [a-z]$/.test(left);
  const rightLetter = /^section [a-z]$/.test(right);
  return Number(rightLetter) - Number(leftLetter) || naturalCompare(left, right);
}

export function activeInventoryForZones(rows, zones, cemetery) {
  const allowedNames = new Set();
  const allowedIds = new Set();
  zones.forEach(zone => {
    const props = zone.properties || zone;
    if ((props.cemetery_code || 'old') !== cemetery || props.is_active === false || props.is_retired) return;
    allowedNames.add(sectionKey(props.name));
    allowedIds.add(String(zone.id || props.id));
  });
  return rows.filter(row => row.cemeteryCode === cemetery && (row.kind === 'ground' && row.section_record != null
    ? allowedIds.has(String(row.section_record)) : allowedNames.has(sectionKey(row.sectionName))));
}

export function inventoryUnit(row, kind) {
  const sectionName = row.section_name || row.section || 'Unassigned';
  const position = String(row.plot_id || '').match(/-R(\d+)-C(\d+)$/i)
    || String(row.location_description || '').match(/Row\s+(\d+),\s*Column\s+(\d+)/i);
  return {
    ...row, kind, key: `${kind}:${row.id}`, sectionName,
    label: kind === 'ground' ? row.plot_id : `Niche F${pad(row.floor)}-C${pad(row.col)}`,
    cemeteryCode: row.cemetery_code || row.cemetery_map || row.cemeteryMap || 'old',
    positionLabel: kind === 'niche' ? `Floor ${row.floor}, Column ${row.col}`
      : position ? `Row ${Number(position[1])}, Column ${Number(position[2])}` : `Plot ${row.plot_number}`,
  };
}

export function buildInventory(plots, niches) {
  return [...plots.map(row => inventoryUnit(row, 'ground')), ...niches.map(row => inventoryUnit(row, 'niche'))]
    .sort((a, b) => a.cemeteryCode.localeCompare(b.cemeteryCode)
      || compareInventorySections(a.sectionName, b.sectionName)
      || a.kind.localeCompare(b.kind)
      || (a.kind === 'niche' ? Number(a.floor) - Number(b.floor) || Number(a.col) - Number(b.col) : Number(a.plot_number) - Number(b.plot_number)));
}

export function filterInventory(rows, { cemetery, section = 'all', kind = 'all', status = 'all', search = '', column = 'all' }) {
  const query = normalizeInventoryText(search);
  const selectedSection = section === 'all' ? null : sectionKey(section);
  return rows.filter(row => row.cemeteryCode === cemetery
    && (selectedSection === null || sectionKey(row.sectionName) === selectedSection)
    && (kind === 'all' || row.kind === kind)
    && (column === 'all' || (row.kind === 'niche' && Number(row.col) === Number(column)))
    && (status === 'all' || row.status === status)
    && (!query || normalizeInventoryText(`${row.label} ${row.id} ${row.legacy_plot_id || ''} ${row.sectionName} ${row.positionLabel} ${row.name || ''}`).includes(query)));
}

export function inventoryTotals(rows) {
  const counts = () => ({ total: 0, available: 0, occupied: 0, maintenance: 0 });
  const totals = { ground: counts(), niche: counts() };
  for (const row of rows) {
    const type = totals[row.kind];
    if (!type) continue;
    type.total += 1;
    if (['available', 'occupied', 'maintenance'].includes(row.status)) type[row.status] += 1;
  }
  return totals;
}

// A column identifies a vertical stack within one section and cemetery.
// Count existing positions, never total niches / an assumed number of floors.
// These are views of niche records, not additional assignable burial units.
export function buildStackInventory(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.kind !== 'niche') continue;
    const key = JSON.stringify([row.cemeteryCode, sectionKey(row.sectionName), Number(row.col)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, niches]) => {
    const first = niches[0];
    const counts = inventoryTotals(niches).niche;
    const floors = [...new Set(niches.map(row => Number(row.floor)))].sort((a, b) => a - b);
    const status = counts.maintenance ? 'maintenance'
      : counts.occupied === counts.total ? 'occupied'
      : counts.occupied ? 'partial'
      : counts.available === counts.total ? 'available' : 'other';
    return {
      key: `stack:${key}`, id: key, kind: 'stack', cemeteryCode: first.cemeteryCode,
      sectionName: first.sectionName, col: Number(first.col), floors, counts, status,
      label: `Stack C${pad(first.col)}`,
      positionLabel: `Column ${first.col} · Floors ${floors.join(', ')}`,
      name: niches.map(row => row.name).filter(Boolean).join(', '),
    };
  }).sort((a, b) => a.cemeteryCode.localeCompare(b.cemeteryCode)
    || compareInventorySections(a.sectionName, b.sectionName) || a.col - b.col);
}

export function inventorySectionTotals(rows, sectionNames) {
  const groups = new Map(sectionNames.map(name => [sectionKey(name), { name, rows: [] }]));
  for (const row of rows) {
    const key = sectionKey(row.sectionName);
    if (!groups.has(key)) groups.set(key, { name: row.sectionName, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group => ({
    name: group.name,
    // Only count positions here; building and sorting full stack views is unnecessary.
    stacks: new Set(group.rows.filter(row => row.kind === 'niche').map(row =>
      JSON.stringify([row.cemeteryCode, Number(row.col)])
    )).size,
    ...inventoryTotals(group.rows),
  })).sort((a, b) => compareInventorySections(a.name, b.name));
}

export function inventorySections(rows, zones, cemetery) {
  const names = new Map();
  const add = name => { if (name && !names.has(sectionKey(name))) names.set(sectionKey(name), name); };
  zones.forEach(zone => {
    const props = zone.properties || zone;
    if ((props.cemetery_code || 'old') === cemetery && props.is_active !== false && !props.is_retired) add(props.name);
  });
  rows.filter(row => row.cemeteryCode === cemetery).forEach(row => add(row.sectionName));
  return [...names.values()].sort(compareInventorySections);
}

export function inventoryCsv(rows) {
  const escape = value => {
    const text = String(value ?? '');
    return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  return [['Reference', 'Type', 'Cemetery', 'Section', 'Position', 'Status', 'Occupant'], ...rows.map(row => [
    row.label, row.kind === 'stack' ? 'Stack position' : row.kind === 'ground' ? 'Saved ground layout' : 'Apartment niche', row.cemeteryCode === 'new' ? 'New Cemetery' : 'Old Cemetery',
    row.sectionName, row.positionLabel, row.status, row.name || '',
  ])].map(row => row.map(escape).join(',')).join('\r\n');
}
