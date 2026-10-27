const parseGridPosition = (plot) => {
  const match = String(plot.location_description || '').match(/Row\s+(\d+),\s*Column\s+(\d+)/i)
    || String(plot.plot_id || '').match(/R(\d+)-C(\d+)$/i);
  return match ? { row: Number(match[1]), column: Number(match[2]) } : null;
};

const interpolate = (start, end, amount) => [
  start[0] + (end[0] - start[0]) * amount,
  start[1] + (end[1] - start[1]) * amount,
];

// Original map columns run along p3→p2 / p0→p1, then split into two sides.
// Preserve this ordering when those formerly browser-only cells are saved.
export function legacyTwoSidedCorners(vertices, row, column, columns = 42) {
  const [p0, p1, p2, p3] = vertices;
  const start = (column - 1) / columns, end = column / columns;
  const leftStart = interpolate(p3, p2, start), leftEnd = interpolate(p3, p2, end);
  const rightStart = interpolate(p0, p1, start), rightEnd = interpolate(p0, p1, end);
  const from = (row - 1) / 2, to = row / 2;
  return [interpolate(leftStart, rightStart, from), interpolate(leftEnd, rightEnd, from),
    interpolate(leftEnd, rightEnd, to), interpolate(leftStart, rightStart, to)];
}

// GeoJSON quadrilaterals do not share a starting corner. Pick the pair of
// opposing edges by map direction so "vertical" always produces north-south
// plot cells, regardless of the order in which the boundary was drawn.
export function useFirstToFourthGridEdges(vertices, orientation) {
  const [p0, p1, , p3] = vertices;
  const horizontalScore = (start, end) => {
    const dx = (Number(end[0]) - Number(start[0])) * Math.cos(Number(start[1]) * Math.PI / 180);
    const dy = Number(end[1]) - Number(start[1]);
    return Math.abs(dx) / Math.max(Math.hypot(dx, dy), Number.EPSILON);
  };
  const firstEdgeIsEastWest = horizontalScore(p0, p1) > horizontalScore(p3, p0);
  return orientation === 'vertical' ? firstEdgeIsEastWest : !firstEdgeIsEastWest;
}

export function getSavedSectionStatusColor(status) {
  if (status === 'planned') return '#CE1126';
  if (status === 'maintenance') return '#F59E0B';
  return '#1687C9';
}

export function buildSavedSectionPlotFeatures(sections, plots) {
  const features = [];
  sections.forEach(section => {
    const props = section.properties || {};
    if (props.is_active === false) return;
    const sectionId = section.id || props.id;
    const ring = section.geometry?.coordinates?.[0];
    const vertices = Array.isArray(ring) ? ring.slice(0, -1) : [];
    if (!sectionId || vertices.length < 3) return;
    const sectionPlots = plots.filter(plot => String(plot.section_record) === String(sectionId));
    const positions = sectionPlots.map(plot => ({ plot, position: parseGridPosition(plot) })).filter(item => item.position);
    if (!positions.length) return;
    const maxRow = Number(props.layout_rows) || Math.max(...positions.map(item => item.position.row));
    const maxColumn = Number(props.layout_columns) || Math.max(...positions.map(item => item.position.column));
    const orientation = props.layout_orientation || 'horizontal';
    const [p0, p1, p2, p3] = vertices;
    const lngs = vertices.map(point => Number(point[0]));
    const lats = vertices.map(point => Number(point[1]));
    const halfHeight = ((Math.max(...lats) - Math.min(...lats)) / (orientation === 'vertical' ? maxRow : maxColumn)) * 0.36;
    const halfWidth = ((Math.max(...lngs) - Math.min(...lngs)) / (orientation === 'vertical' ? maxColumn : maxRow)) * 0.36;

    positions.forEach(({ plot, position }) => {
      let corners;
      if (vertices.length === 4 && section.geometry.plot_layout === 'legacy-two-sided') {
        corners = legacyTwoSidedCorners(vertices, position.row, position.column);
      } else if (vertices.length === 4) {
        const alongStart = (position.row - 1) / maxRow;
        const alongEnd = position.row / maxRow;
        const acrossStart = (position.column - 1) / maxColumn;
        const acrossEnd = position.column / maxColumn;
        const useFirstToFourth = useFirstToFourthGridEdges(vertices, orientation);
        const leftStart = useFirstToFourth ? interpolate(p0, p3, alongStart) : interpolate(p3, p2, alongStart);
        const rightStart = useFirstToFourth ? interpolate(p1, p2, alongStart) : interpolate(p0, p1, alongStart);
        const leftEnd = useFirstToFourth ? interpolate(p0, p3, alongEnd) : interpolate(p3, p2, alongEnd);
        const rightEnd = useFirstToFourth ? interpolate(p1, p2, alongEnd) : interpolate(p0, p1, alongEnd);
        corners = [
          interpolate(leftStart, rightStart, acrossStart),
          interpolate(leftStart, rightStart, acrossEnd),
          interpolate(leftEnd, rightEnd, acrossEnd),
          interpolate(leftEnd, rightEnd, acrossStart),
        ];
      } else {
        const lng = Number(plot.longitude), lat = Number(plot.latitude);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        corners = [
          [lng - halfWidth, lat - halfHeight], [lng + halfWidth, lat - halfHeight],
          [lng + halfWidth, lat + halfHeight], [lng - halfWidth, lat + halfHeight],
        ];
      }
      // Navigation must target the center of the polygon the user actually
      // clicked. For a skewed four-corner section this can differ materially
      // from the axis-aligned grid coordinate stored during layout creation.
      const renderedCenter = corners.reduce(
        (total, point) => [total[0] + Number(point[0]), total[1] + Number(point[1])],
        [0, 0],
      ).map(total => total / corners.length);
      corners.push(corners[0]);
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [corners] },
        properties: {
          ...plot,
          row: position.row,
          column: position.column,
          niche_column: section.geometry.plot_layout === 'legacy-two-sided'
            ? (position.row - 1) * 42 + position.column
            : (props.layout_rows && props.layout_columns ? (position.row - 1) * maxColumn + position.column : null),
          latitude: renderedCenter[1],
          longitude: renderedCenter[0],
          rendered_center: [renderedCenter[1], renderedCenter[0]],
          section_status: props.status || 'active',
          section_code: props.zone_code,
          section_name: props.name || plot.section_name,
          floors: props.estimated_stack_height || 1,
          cemetery_code: props.cemetery_code || plot.cemetery_code,
        },
      });
    });
  });
  return { type: 'FeatureCollection', features };
}
