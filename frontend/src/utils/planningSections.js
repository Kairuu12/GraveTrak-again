// Both the zoning sidebar and dashboard must use this section catalogue.
// Saved names (including archived/deleted names and rename sources) override
// the original map. Inventory rows alone never introduce a section.
export function planningSectionName(value) {
  const name = String(value || '').trim()
    .replace(/^Section\s+(?=Expansion Area)/i, '')
    .replace(/^Expansion Area/i, 'Section');
  const letter = name.match(/^(?:sec(?:tion)?\s*)?([a-z])$/i);
  return letter ? `Section ${letter[1].toUpperCase()}` : name;
}

const keyFor = value => planningSectionName(value).toLowerCase();

// Retirement markers suppress old map geometry but do not reserve names/codes.
// Archived real records still reserve theirs until permanently deleted.
export function findSectionConflict(sections, { cemetery, name, zoneCode, excludeId }) {
  return sections.find(section => {
    const props = section.properties || section;
    if (props.is_retired || (props.cemetery_code || 'old') !== cemetery
        || (excludeId != null && String(section.id || props.id) === String(excludeId))) return false;
    return name != null ? keyFor(props.name) === keyFor(name)
      : String(props.zone_code || '').trim().toUpperCase() === String(zoneCode || '').trim().toUpperCase();
  });
}

export function findPlanningSection(sections, name) {
  const key = keyFor(name);
  if (!key) return undefined;
  const current = sections.filter(section => {
    const props = section.properties || section;
    return props.is_active !== false && !props.is_retired;
  });
  // A current name wins over a historical alias if the old name was reused.
  return current.find(section => keyFor((section.properties || section).name) === key)
    || current.find(section => keyFor((section.properties || section).legacy_source_name) === key);
}

export function planningSectionSidebarId(name, cemetery) {
  return `zone-sidebar-${cemetery}-${encodeURIComponent(keyFor(name))}`;
}

export function resolvePlanningSections(savedSections, mapFeatures, cemetery) {
  const saved = savedSections.filter(zone => {
    const props = zone.properties || zone;
    return (props.cemetery_code || 'old') === cemetery;
  });
  const managedNames = new Set(saved.flatMap(zone => {
    const props = zone.properties || zone;
    return [keyFor(props.name), keyFor(props.legacy_source_name)];
  }).filter(Boolean));
  const sections = new Map();
  for (const zone of saved) {
    const props = zone.properties || zone;
    if (!props.name || props.is_active === false || props.is_retired) continue;
    sections.set(keyFor(props.name), {
      ...zone,
      properties: { ...props, cemetery_code: cemetery, status: props.status || 'planned' },
    });
  }
  for (const [index, feature] of mapFeatures.entries()) {
    if (feature.geometry?.type !== 'Polygon') continue;
    const name = planningSectionName(feature.properties?.name || feature.properties?.id);
    const key = keyFor(name);
    if (!name || managedNames.has(key) || sections.has(key)) continue;
    const columns = cemetery === 'new' ? 62 : 42;
    sections.set(key, {
      ...feature,
      id: `legacy-${cemetery}-${feature.properties?.id || index}`,
      isLegacySidebar: true,
      properties: {
        ...feature.properties, name, cemetery_code: cemetery, zone_code: 'EXISTING',
        status: 'active', is_active: true, estimated_stack_height: 4,
        total_plots: columns * 2, available_plots: columns * 2, occupied_plots: 0,
      },
    });
  }
  return [...sections.values()];
}

export function planningSectionStatusCounts(sections) {
  const counts = { active: 0, planned: 0, maintenance: 0, unknown: 0 };
  for (const section of sections) {
    const props = section.properties || section;
    if (props.is_active === false || props.is_retired) continue;
    counts[Object.hasOwn(counts, props.status) ? props.status : 'unknown']++;
  }
  return counts;
}
