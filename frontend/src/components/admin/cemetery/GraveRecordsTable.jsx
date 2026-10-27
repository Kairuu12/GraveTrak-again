import { useMemo, useState } from 'react';
import { memorialLabel } from './ApartmentNicheWall.jsx';
import { compareInventorySections } from '../../../utils/cpdoInventory.js';
import './GraveRecordsTable.css';

const PAGE_SIZE = 10;
const occupants = slot => String(slot.name || '').split(/,\s*(?!\d)/).filter(Boolean).map(name => memorialLabel({ name }));
const csvCell = value => {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
};

export default function GraveRecordsTable({ slots, cemetery, onViewNiche, onManage, getSide, getColumn }) {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('');
  const [floor, setFloor] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('location');
  const [page, setPage] = useState(1);
  const inventory = useMemo(() => slots.filter(slot => slot.cemeteryMap === cemetery), [slots, cemetery]);
  const sections = useMemo(() => [...new Set(inventory.map(slot => slot.section))].sort(compareInventorySections), [inventory]);
  const floors = [...new Set(inventory.filter(slot => !section || slot.section === section).map(slot => Number(slot.floor)))].sort((a, b) => a - b);
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return inventory.filter(slot => (!section || slot.section === section) && (!floor || Number(slot.floor) === Number(floor)) && (!status || slot.status === status) && words.every(word => `${slot.id} ${slot.name || ''} ${slot.section}`.toLowerCase().includes(word))).sort((a, b) => {
      if (sort !== 'location') {
        const names = memorialLabel(a).name.localeCompare(memorialLabel(b).name, undefined, { sensitivity: 'base' });
        if (names) return sort === 'name-desc' ? -names : names;
      }
      return compareInventorySections(a.section, b.section) || Number(a.floor) - Number(b.floor) || Number(a.col) - Number(b.col);
    });
  }, [inventory, query, section, floor, status, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const update = setter => event => { setter(event.target.value); setPage(1); };
  function exportRecords() {
    const data = [['Niche ID', 'Occupant name', 'Death date (as recorded)', 'Cemetery', 'Section', 'Side', 'Floor', 'Column', 'Status', 'Details']];
    rows.forEach(slot => {
      const people = occupants(slot);
      (people.length ? people : [{ name: '', deathDate: '' }]).forEach(person => data.push([slot.id, person.name, person.deathDate, cemetery === 'new' ? 'New Cemetery' : 'Old Cemetery', slot.section, getSide(slot), slot.floor, getColumn(slot), slot.status, slot.status === 'occupied' && (!person.name || !person.deathDate) ? 'Incomplete details' : '']));
    });
    const url = URL.createObjectURL(new Blob(['\uFEFF' + data.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `gravetrak-${cemetery}-filtered-records.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="grave-records-table">
    <div className="records-filters">
      <label className="records-search">Search records<input type="search" value={query} onChange={update(setQuery)} placeholder="Name, niche ID, or section" /></label>
      <label>Section<select value={section} onChange={event => { setSection(event.target.value); setFloor(''); setPage(1); }}><option value="">All sections</option>{sections.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Floor<select value={floor} onChange={update(setFloor)}><option value="">All floors</option>{floors.map(item => <option key={item} value={item}>Floor {item}</option>)}</select></label>
      <label>Status<select value={status} onChange={update(setStatus)}><option value="">All statuses</option>{['available', 'occupied', 'reserved'].map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={update(setSort)}><option value="location">Section / floor / column</option><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option></select></label>
    </div>
    <div className="records-summary"><span role="status">{rows.length} matching niches · {cemetery === 'new' ? 'New' : 'Old'} Cemetery</span><button type="button" className="btn btn-ghost btn-sm" disabled={!rows.length} onClick={exportRecords}>Export filtered CSV</button></div>
    <div className="records-table-scroll" tabIndex={0} aria-label="Grave records; scroll horizontally for more columns">
      <table><thead><tr>{['Name / Niche ID', 'Death date', 'Cemetery', 'Section', 'Side', 'Floor / Column', 'Status', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.slice(start, start + PAGE_SIZE).map(slot => {
          const people = occupants(slot);
          const incomplete = slot.status === 'occupied' && (!people.length || people.some(person => !person.name || !person.deathDate));
          return <tr key={slot.id}>
            <td>{people.length ? people.map((person, index) => <strong className="record-person" key={index}>{person.name}</strong>) : <span>{slot.status === 'occupied' ? 'Name not recorded' : 'No occupant'}</span>}<small>{slot.id}</small>{incomplete && <span className="record-incomplete">Incomplete details</span>}</td>
            <td>{people.length ? people.map((person, index) => <div className="record-person" key={index}>{person.deathDate || 'Not recorded'}</div>) : '—'}</td>
            <td>{cemetery === 'new' ? 'New' : 'Old'} Cemetery</td><td>{slot.section}</td><td>{getSide(slot)}</td><td>F{slot.floor} · C{getColumn(slot)}</td>
            <td><span className={`record-status ${slot.status}`}>{slot.status}</span></td>
            <td><div className="record-actions"><button type="button" className="btn btn-primary btn-xs" onClick={() => onViewNiche(slot)}>View Niche</button><button type="button" className="btn btn-ghost btn-xs" onClick={() => onManage(slot)}>Details / Manage</button></div></td>
          </tr>;
        })}{!rows.length && <tr><td colSpan={8}>No records match these filters.</td></tr>}</tbody>
      </table>
    </div>
    <div className="records-summary"><span>{rows.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} of ${rows.length}` : '0 records'} · Page {currentPage} of {pages}</span><div className="record-actions"><button className="btn btn-ghost btn-sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="btn btn-ghost btn-sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    <p className="records-note">Death dates are shown as recorded. Missing details do not change niche occupancy. Export includes all matching records across pages.</p>
  </section>;
}
