import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchBurialPlots, fetchCemeterySections, fetchColumbariums, managePlotMaintenance } from '../../../api.js';
import { activeInventoryForZones, buildInventory, filterInventory, inventorySections, inventoryTotals, inventoryUnit } from '../../../utils/cpdoInventory.js';
import './CPDOPlotManager.css';

const PAGE_SIZE = 20;
const unit = inventoryUnit;

export default function CPDOPlotManager({ target, sectionsByCemetery, onClose, onInventoryLoaded, onSaved }) {
  const dialog = useRef(null);
  const initialTargetPending = useRef(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cemetery, setCemetery] = useState(target.cemetery || 'old');
  const [section, setSection] = useState(target.section || 'all');
  const [kind, setKind] = useState(target.kind || 'niche');
  const [column, setColumn] = useState(target.column != null ? String(target.column) : 'all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');

  const load = async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const [plots, niches, zones] = await Promise.all([fetchBurialPlots(), fetchColumbariums(), fetchCemeterySections()]);
      if (!Array.isArray(plots) || !Array.isArray(niches) || !Array.isArray(zones?.features)) throw new Error('Unable to read the inventory response.');
      const next = buildInventory(plots, niches);
      setRows(next);
      onInventoryLoaded(plots, niches, zones.features);
      const requestedKey = selected?.key || (initialTargetPending.current && target.id != null ? `${target.kind}:${target.id}` : '');
      initialTargetPending.current = false;
      const matching = filterInventory(next, { cemetery, section, kind, status, search, column });
      const selectedIndex = matching.findIndex(row => row.key === requestedKey);
      const chosen = selectedIndex >= 0 ? matching[selectedIndex] : null;
      setSelected(chosen || null); setNotes(chosen?.maintenance_notes || '');
      setPage(selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE_SIZE) + 1 : 1);
    } catch (err) { setError(err.message); setRows([]); setSelected(null); setNotes(''); }
    finally { setLoading(false); }
  };
  useEffect(() => { dialog.current?.showModal(); load(); }, []);
  const activeRows = useMemo(() => activeInventoryForZones(rows, sectionsByCemetery[cemetery], cemetery), [rows, sectionsByCemetery, cemetery]);
  const sections = useMemo(() => inventorySections(activeRows, sectionsByCemetery[cemetery], cemetery), [activeRows, sectionsByCemetery, cemetery]);
  const columns = useMemo(() => [...new Set(filterInventory(activeRows, { cemetery, section, kind: 'niche' }).map(row => row.col))].sort((a, b) => a - b), [activeRows, cemetery, section]);
  const filtered = useMemo(() => filterInventory(activeRows, { cemetery, section, kind, status, search, column }), [activeRows, cemetery, section, kind, status, search, column]);
  const counts = useMemo(() => inventoryTotals(filtered), [filtered]);
  const sectionHasRecords = useMemo(() => filterInventory(activeRows, { cemetery, section, kind }).length > 0, [activeRows, cemetery, section, kind]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const changeFilter = setter => event => { setter(event.target.value); setPage(1); setSelected(null); setNotice(''); };
  const save = async operation => {
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await managePlotMaintenance(selected.kind, selected.id, {
        operation, notes, expected_updated_at: selected.updated_at,
      });
      const updated = unit(result, selected.kind);
      setRows(current => current.map(row => row.key === updated.key ? updated : row));
      setSelected(updated); setNotes(updated.maintenance_notes || '');
      setNotice(operation === 'complete' ? `Maintenance completed. Status restored to ${updated.status}.` : operation === 'start' ? 'This unit is now under maintenance.' : 'Maintenance notes saved.');
      await onSaved(updated.kind, result);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return <dialog ref={dialog} className="cpdo-unit-dialog" aria-labelledby="cpdo-unit-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><div><h2 id="cpdo-unit-title">Manage Individual Plots & Niches</h2><p>Maintain one unit at a time. Its section and neighboring units stay unchanged.</p></div><button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>Close</button></header>
    <div className="cpdo-unit-filters">
      <label>Cemetery<select value={cemetery} disabled={saving || loading} onChange={event => { changeFilter(setCemetery)(event); setSection('all'); setColumn('all'); }}><option value="old">Old Cemetery</option><option value="new">New Cemetery</option></select></label>
      <label>Type<select value={kind} disabled={saving || loading} onChange={event => { changeFilter(setKind)(event); setColumn('all'); }}><option value="all">All records</option><option value="ground">Saved ground layouts</option><option value="niche">Apartment niches</option></select></label>
      <label>Section<select value={section} disabled={saving || loading} onChange={event => { changeFilter(setSection)(event); setColumn('all'); }}><option value="all">All sections ({sections.length})</option>{sections.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Status<select value={status} disabled={saving || loading} onChange={changeFilter(setStatus)}><option value="all">All statuses</option>{['available', 'occupied', 'maintenance'].map(value => <option key={value}>{value}</option>)}</select></label>
      {kind === 'niche' && <label>Stack / Column<select value={column} disabled={saving || loading} onChange={changeFilter(setColumn)}><option value="all">All stacks</option>{columns.map(value => <option key={value} value={value}>Column {value}</option>)}</select></label>}
      <label className="cpdo-unit-search">Search<input type="search" placeholder="Plot/niche ID, section, or occupant" value={search} disabled={saving || loading} onChange={changeFilter(setSearch)} /></label>
      <button className="btn btn-ghost" disabled={loading || saving} onClick={load}>Refresh</button>
    </div>
    {kind !== 'niche' && <p className="cpdo-unit-help">Saved ground layouts describe map positions. Choose Apartment niches to maintain an individual burial compartment. These record counts are separate from niche capacity.</p>}
    {error && <p className="cpdo-unit-error" role="alert">{error}</p>}
    {notice && <p className="cpdo-unit-notice" role="status">{notice}</p>}
    <div className="cpdo-unit-body">
      <section aria-label="Individual inventory" aria-busy={loading}>
        <p>{loading ? 'Loading current inventory…' : `${filtered.length.toLocaleString()} matching records (${counts.niche.total.toLocaleString()} niches, ${counts.ground.total.toLocaleString()} saved ground layouts)`}</p>
        {!loading && !filtered.length && <p>{section !== 'all' && !sectionHasRecords ? `No ${kind === 'ground' ? 'saved ground layouts' : kind === 'niche' ? 'niches' : 'inventory records'} are registered for ${section} yet. This section exists in Zoning; verify its layout before registering units.` : 'No records match these filters. Try another status, stack, or search.'}</p>}
        <div className="cpdo-unit-list">{!loading && filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(row => <button type="button" key={row.key} className={selected?.key === row.key ? 'selected' : ''} disabled={saving} aria-pressed={selected?.key === row.key} onClick={() => { setSelected(row); setNotes(row.maintenance_notes || ''); setError(''); setNotice(''); }}>
          <strong>{row.label}</strong><span className={`cpdo-unit-status ${row.status}`}>{row.status}</span>
          <small>{row.kind === 'ground' ? 'Saved ground layout' : `Niche · Floor ${row.floor}, Column ${row.col}`} · {row.sectionName}</small>
          {row.name && <small>{row.name}</small>}
        </button>)}</div>
        <div className="cpdo-unit-paging"><button className="btn btn-ghost" disabled={saving || loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pages}</span><button className="btn btn-ghost" disabled={saving || loading || currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
      </section>
      <section className="cpdo-unit-editor" aria-label="Selected unit">
        {selected ? <><h3>{selected.label}</h3><p>{selected.cemeteryCode === 'new' ? 'New' : 'Old'} Cemetery · {selected.sectionName}</p>
          <p>{selected.positionLabel}</p>
          <p>Status: <strong>{selected.status}</strong></p>{selected.name && <p>Occupant: {selected.name}</p>}
          {selected.status === 'maintenance' && selected.maintenance_previous_status && <p>Status before maintenance: <strong>{selected.maintenance_previous_status}</strong></p>}
          <label>Maintenance reason / notes<textarea rows={5} maxLength={5000} value={notes} disabled={saving || loading} onChange={event => setNotes(event.target.value)} placeholder="Describe the repair or maintenance needed for this unit." /></label>
          <p className="cpdo-unit-help">Occupant records and burial assignments are preserved. Completing maintenance restores the previous status.</p>
          <div className="cpdo-unit-actions">{selected.status === 'maintenance' ? <><button className="btn btn-ghost" disabled={saving || loading} onClick={() => save('update')}>Save Notes</button><button className="btn btn-primary" disabled={saving || loading} onClick={() => save('complete')}>Complete Maintenance</button></> : <button className="btn btn-primary" disabled={saving || loading || !notes.trim() || !['available', 'occupied'].includes(selected.status)} onClick={() => save('start')}>Start Maintenance</button>}</div>
          {saving && <p role="status">Saving changes…</p>}
        </> : <p>Select a ground plot or niche to manage its maintenance.</p>}
      </section>
    </div>
  </dialog>;
}
