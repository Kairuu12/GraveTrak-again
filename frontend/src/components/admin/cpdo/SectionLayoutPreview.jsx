import React from 'react';

export default function SectionLayoutPreview({ rows, columns, floors }) {
  rows = Number(rows); columns = Number(columns); floors = Number(floors);
  if (![1, 2].includes(rows) || !Number.isInteger(columns) || columns < 1 || columns > 132
      || !Number.isInteger(floors) || floors < 1 || floors > 10) {
    return <p role="status">Choose 1 or 2 rows, 1–132 columns, and 1–10 levels to preview the layout.</p>;
  }
  return <div aria-label="Section layout preview" style={{ padding: 12, marginBottom: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
    <strong style={{ fontSize: 12 }}>Layout preview · top view</strong>
    <div style={{ overflowX: 'auto', padding: '10px 0' }}>
      <div style={{ minWidth: Math.max(200, columns * 24) }}>
        {Array.from({ length: rows }, (_, row) => <div key={row} style={{ marginBottom: 8 }}>
          <small>{row === 0 ? 'Front' : 'Back'}</small>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(20px, 1fr))`, gap: 2, marginTop: 4 }}>
            {Array.from({ length: columns }, (_, col) => <span key={col} style={{ textAlign: 'center', padding: '5px 0', fontSize: 10, background: 'rgba(22,135,201,.16)', border: '1px solid var(--accent)', borderRadius: 2 }}>{col + 1}</span>)}
          </div>
        </div>)}
      </div>
    </div>
    <div role="status" style={{ fontSize: 12 }}><strong>{rows} row{rows === 1 ? '' : 's'} × {columns} columns × {floors} levels = {rows * columns * floors} niche slots</strong></div>
    <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>Levels are stacked upward. This diagram shows the arrangement, not the boundary shape. For irregular polygons, only map positions whose centers fit inside the boundary are generated.</p>
  </div>;
}
