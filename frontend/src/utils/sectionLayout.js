// Explicit dimensions survive polygon clipping and reloads. Older sections
// can still recover their grid from the saved plot positions.
export function getSectionLayout(section, plots = []) {
  const props = section?.properties || section || {};
  if (Number(props.layout_rows) > 0 && Number(props.layout_columns) > 0) {
    return { rows: Number(props.layout_rows), columns: Number(props.layout_columns) };
  }
  let rows = 0, columns = 0;
  for (const plot of plots) {
    const match = String(plot.location_description || '').match(/Row\s+(\d+),\s*Column\s+(\d+)/i)
      || String(plot.plot_id || '').match(/R(\d+)-C(\d+)$/i);
    if (match) {
      rows = Math.max(rows, Number(match[1]));
      columns = Math.max(columns, Number(match[2]));
    }
  }
  return rows && columns ? { rows, columns } : null;
}

export function getNichePosition(slot, layout) {
  const col = Number(slot?.col || 0);
  const columns = layout?.columns || ((slot?.cemeteryMap || slot?.cemetery_map) === 'new' ? 66 : 42);
  const rows = layout?.rows || 2;
  return {
    side: rows === 1 || col <= columns ? 'Front' : 'Back',
    column: rows === 1 ? col : ((col - 1) % columns) + 1,
  };
}
