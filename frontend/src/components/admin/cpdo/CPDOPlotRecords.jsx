import { useEffect, useMemo, useState } from 'react';
import { activeInventoryForZones, buildStackInventory, filterInventory, inventoryCsv, inventorySections, inventorySectionTotals } from '../../../utils/cpdoInventory.js';
import './CPDOPlotRecords.css';

const PAGE_SIZE = 10;
export default function CPDOPlotRecords({ active, inventoryRows, zones, cemetery, onCemeteryChange, onManage, onViewMap, onRefresh, error }) {
  const [section, setSection] = useState('all');
  const [kind, setKind] = useState('stack');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const rows = useMemo(() => activeInventoryForZones(inventoryRows, zones, cemetery), [inventoryRows, zones, cemetery]);
  const sectionNames = useMemo(() => inventorySections(rows, zones, cemetery), [rows, zones, cemetery]);
  const stacks = useMemo(() => buildStackInventory(rows), [rows]);
  const sectionTotals = useMemo(() => inventorySectionTotals(rows, sectionNames), [rows, sectionNames]);
  const totalSlots = useMemo(() => sectionTotals.reduce((total, item) => total + item.niche.total, 0), [sectionTotals]);
  const filtered = useMemo(() => filterInventory(kind === 'stack' ? stacks : rows, { cemetery, section, kind, status, search }), [rows, stacks, cemetery, section, kind, status, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const currentRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => { setSection('all'); setPage(1); }, [cemetery]);
  const change = setter => event => { setter(event.target.value); setPage(1); };
  const refresh = async () => {
    setRefreshing(true); setRefreshError('');
    try { await onRefresh(); } catch (err) { setRefreshError(err.message); }
    finally { setRefreshing(false); }
  };
  useEffect(() => { if (active) refresh(); }, [active]);
  const download = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', inventoryCsv(filtered)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = `cpdo-${cemetery}-plot-records.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="scroll-panel cpdo-records">
    <div className="page-hdr"><div><h1 className="page-title">Plot Records</h1><p className="page-sub">Stack positions and their individual apartment niches.</p></div><div className="page-actions"><button type="button" className="btn btn-ghost" disabled={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh Records'}</button><button type="button" className="btn btn-primary" disabled={!filtered.length} onClick={download}>Export Filtered CSV</button></div></div>
    <section className="cpdo-records-overview" aria-label="Plot inventory totals">
      <div className="cpdo-overview-heading"><h2>Plot inventory</h2><span>{cemetery === 'new' ? 'New' : 'Old'} Cemetery</span></div>
      <div className="cpdo-records-summary">
        <div className="cpdo-stat-featured"><h3>Stack positions</h3>
          <div className="cpdo-records-total"><strong>{stacks.length.toLocaleString()}</strong></div>
          <p>One position per vertical column of niches.</p>
          <button type="button" className="cpdo-stat-link" onClick={() => { setKind('stack'); setSection('all'); setStatus('all'); setSearch(''); setPage(1); }}>View stack positions <span aria-hidden="true">&rarr;</span></button>
        </div>
        <div><h3>Total slots</h3>
          <div className="cpdo-records-total"><strong>{totalSlots.toLocaleString()}</strong></div>
          <p>All recorded individual niches within the stacks, across all statuses.</p>
          <button type="button" className="cpdo-stat-link" onClick={() => { setKind('niche'); setSection('all'); setStatus('all'); setSearch(''); setPage(1); }}>View individual slots <span aria-hidden="true">&rarr;</span></button>
        </div>
        <div><h3>Current sections</h3>
          <div className="cpdo-records-total"><strong>{sectionTotals.length.toLocaleString()}</strong></div>
          <p>Across the selected cemetery, excluding archived and deleted sections.</p>
        </div>
      </div>
      <p className="cpdo-inventory-note">Stacks contain niches; they are not additional burial spaces. Overview totals cover all current sections.</p>
      <details className="cpdo-records-breakdown">
        <summary>View plot counts by section ({sectionTotals.length})</summary>
        <div className="cpdo-records-table"><table>
          <caption>Stack positions in all current sections.</caption>
          <thead><tr><th scope="col">Section</th><th scope="col">Stack positions</th></tr></thead>
          <tbody>{sectionTotals.map(item => <tr key={item.name}>
            <th scope="row"><button type="button" className="btn btn-xs btn-ghost" onClick={() => { setSection(item.name); setKind('stack'); setStatus('all'); setSearch(''); setPage(1); }}>{item.name}</button></th>
            <td>{item.stacks.toLocaleString()}</td>
          </tr>)}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>{stacks.length.toLocaleString()}</td></tr></tfoot>
        </table></div>
      </details>
    </section>
    <section className="cpdo-filter-panel" aria-label="Filter plot records">
    <div className="cpdo-filter-heading"><h2>Find records</h2><span>10 records per page</span></div>
    <div className="cpdo-records-filters">
      <label>Cemetery<select value={cemetery} onChange={event => onCemeteryChange(event.target.value)}><option value="old">Old Cemetery</option><option value="new">New Cemetery</option></select></label>
      <label>Section<select value={section} onChange={change(setSection)}><option value="all">All sections ({sectionNames.length})</option>{sectionNames.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Record type<select value={kind} onChange={event => { change(setKind)(event); setStatus('all'); }}><option value="stack">Stack positions</option><option value="niche">Individual apartment niches</option><option value="ground">Saved ground layouts</option></select></label>
      <label>Status<select value={status} onChange={change(setStatus)}><option value="all">All statuses</option>{['available', 'occupied', 'maintenance', ...(kind === 'stack' ? ['partial', 'other'] : [])].map(value => <option key={value} value={value}>{kind === 'stack' && value === 'occupied' ? 'Fully occupied' : kind === 'stack' && value === 'available' ? 'All niches available' : value === 'partial' ? 'Partly occupied' : value}</option>)}</select></label>
      <label className="cpdo-records-search">Search records<input type="search" value={search} onChange={change(setSearch)} placeholder="Reference, section, row, floor, or occupant" /></label>
      <button type="button" className="btn btn-ghost" onClick={() => { setSection('all'); setKind('stack'); setStatus('all'); setSearch(''); setPage(1); }}>Clear Filters</button>
    </div>
    </section>
    {(error || refreshError) && <p role="alert" className="cpdo-records-error">{refreshError || error}</p>}
    <p className="cpdo-records-count" aria-live="polite">{filtered.length.toLocaleString()} matching {kind === 'stack' ? 'stack positions' : kind === 'ground' ? 'saved ground layouts' : 'niches'} · {cemetery === 'new' ? 'New' : 'Old'} Cemetery{section !== 'all' ? ` · ${section}` : ''}</p>
    <div className="cpdo-records-table"><table><thead><tr>{['Reference', 'Type', 'Section', 'Position', 'Status', 'Actions'].map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>
      {currentRows.map(row => <tr key={row.key}><td><strong>{row.label}</strong>{row.name && <small>{row.name}</small>}</td><td>{row.kind === 'stack' ? 'Stack position' : row.kind === 'ground' ? 'Saved ground layout' : 'Apartment niche'}</td><td>{row.sectionName}</td><td>{row.positionLabel}</td><td><span className={`cpdo-records-status ${row.status}`}>{row.kind === 'stack' ? ({ partial: 'Partly occupied', occupied: 'Fully occupied', available: 'All niches available', maintenance: 'Has niche maintenance' }[row.status] || row.status) : row.status}</span>{row.kind === 'stack' && <small>{row.counts.available} available / {row.counts.total} niches</small>}</td><td><div className="cpdo-records-actions"><button type="button" className="btn btn-xs btn-primary" onClick={() => onManage(row)}>{row.kind === 'stack' ? 'View niches' : 'Manage'}</button><button type="button" className="btn btn-xs btn-ghost" onClick={() => onViewMap(row)}>View on Map</button></div></td></tr>)}
      {!currentRows.length && <tr><td colSpan={6} className="cpdo-records-empty">No records match these filters. Choose another record type or clear the filters.</td></tr>}
    </tbody></table></div>
    <div className="cpdo-records-pagination"><span>{filtered.length ? `${((currentPage - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(currentPage * PAGE_SIZE, filtered.length).toLocaleString()} of ${filtered.length.toLocaleString()}` : '0 records'}</span><div><button type="button" className="btn btn-ghost" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pages}</span><button type="button" className="btn btn-ghost" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
  </div>;
}
