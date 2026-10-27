export function staffSearchResults(query, slots, plots, sections) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = text => words.every(word => text.toLowerCase().includes(word));
  const rows = [];
  for (const section of sections) {
    const p = section.properties || section;
    if (p.is_active === false || p.is_retired) continue;
    const cemeteryMap = p.cemetery_code || 'old';
    if (matches(`${p.name} ${p.zone_code || ''} ${cemeteryMap} cemetery`)) rows.push({
      kind: 'section', id: `section:${cemeteryMap}:${p.name}`, name: p.name, section: p.name, cemeteryMap,
      detail: 'Section',
    });
  }
  for (const plot of plots) {
    const cemeteryMap = plot.cemetery_code || 'old';
    const section = plot.section_name || plot.section;
    if (matches(`${plot.plot_id} ${plot.legacy_plot_id || ''} ${section} ${plot.location_description || ''} ${cemeteryMap} cemetery`)) rows.push({
      kind: 'plot', id: plot.plot_id, plotId: plot.id, name: plot.plot_id, section, cemeteryMap,
      detail: `Plot · ${plot.status}`, latitude: plot.latitude, longitude: plot.longitude,
    });
  }
  const niches = [];
  for (const slot of slots) {
    if (matches(`${slot.name || ''} ${slot.id} ${slot.section} ${slot.cemeteryMap} cemetery floor ${slot.floor} column ${slot.col}`)) niches.push({
      ...slot, kind: 'niche', detail: `${slot.name ? 'Person / niche' : 'Niche'} · Floor ${slot.floor}, Column ${slot.col}`,
    });
  }
  // Reserve space for all categories; a section query must not return only its niches.
  return [...rows.filter(row => row.kind === 'section').slice(0, 6),
    ...rows.filter(row => row.kind === 'plot').slice(0, 8), ...niches.slice(0, 10)];
}
