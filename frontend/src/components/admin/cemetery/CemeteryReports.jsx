import { useMemo, useState } from 'react';
import './CemeteryReports.css';

const definitions = {
  burials: { title: 'Completed burials', note: 'Confirmed completed burials whose actual burial date falls within the selected period. Pending applications and scheduled burials are excluded.', columns: [['reference', 'Reference'], ['deceased', 'Deceased'], ['date', 'Actual burial date'], ['status', 'Status'], ['funeral_home', 'Funeral home']] },
  sections: { title: 'Slot inventory', note: 'Inventory at report generation time, not historical availability. Ground layouts are excluded from slot capacity.', columns: [['cemetery', 'Cemetery'], ['section', 'Section'], ['total', 'Total slots'], ['available', 'Available'], ['occupied', 'Occupied'], ['reserved', 'Reserved'], ['maintenance', 'Maintenance'], ['other', 'Other']] },
  maintenance: { title: 'Maintenance follow-up', note: 'Records currently marked for maintenance. This is not a history of repairs completed during the period.', columns: [['reference', 'Reference'], ['kind', 'Type'], ['cemetery', 'Cemetery'], ['section', 'Section'], ['position', 'Position'], ['notes', 'Maintenance notes']] },
  checks: { title: 'Record checks', note: 'Current occupied niches needing review. Death dates are detected from existing name annotations; review the source record before making corrections.', columns: [['reference', 'Niche'], ['cemetery', 'Cemetery'], ['section', 'Section'], ['position', 'Position'], ['occupant', 'Recorded occupant'], ['reason', 'Review reason']] },
};
export default function CemeteryReports({ report }) {
  const [tab, setTab] = useState('burials');
  const [page, setPage] = useState(0);
  const [inventoryCemetery, setInventoryCemetery] = useState('old');
  const data = report?.staff_operations;
  const summary = useMemo(() => ['old', 'new'].map(cemetery => {
    const sections = data?.sections.filter(row => row.cemetery === cemetery) || [];
    return { cemetery, total: sections.reduce((sum, row) => sum + row.total, 0), available: sections.reduce((sum, row) => sum + row.available, 0), occupied: sections.reduce((sum, row) => sum + row.occupied, 0) };
  }), [data]);
  if (!data) return <p>Generate a new report to load the staff operations breakdown.</p>;
  const rows = tab === 'sections' ? data.sections.filter(row => row.cemetery === inventoryCemetery) : data[tab] || [];
  const inventorySummary = summary.find(item => item.cemetery === inventoryCemetery);
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const legacy = data.burials_basis !== 'actual_completion';
  const categories = legacy ? { ...definitions, burials: { ...definitions.burials, title: 'Burial register (previous report)', note: 'This saved report used scheduled burial dates and may include uncompleted burials. Generate a new report for confirmed completed burials.', columns: [['reference', 'Reference'], ['deceased', 'Deceased'], ['date', 'Scheduled burial date'], ['status', 'Status'], ['funeral_home', 'Funeral home']] } } : definitions;
  const definition = categories[tab];
  return <section className="staff-reports">
    <div className="sr-intro"><div><span>STAFF OPERATIONS</span><h2>Service delivery & follow-up</h2><p>{legacy ? 'Previously saved operational snapshot.' : 'Confirmed completed burials for the chosen period, with current inventory and maintenance follow-up.'}</p></div><small>Snapshot captured {new Date(data.generated_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila)</small></div>
    <div className="sr-cards">{[[legacy ? 'Burial-dated applications (previous report)' : 'Completed burials', data.burials.length, legacy ? 'Previous report basis' : 'Actual burial date ? Selected period'], ['Available niche slots', summary.reduce((sum, row) => sum + row.available, 0), 'Current inventory'], ['Maintenance records', data.maintenance.length, 'Niches and layouts, counted separately'], ['Records for review', data.checks.length, 'Current occupied niches']].map(([label, value, note]) => <article key={label}><h3>{label}</h3><strong>{value.toLocaleString()}</strong><small>{note}</small></article>)}</div>
    <div className="sr-capacity">{summary.map(item => <article key={item.cemetery}><h3>{item.cemetery === 'old' ? 'Old' : 'New'} Cemetery</h3><p><strong>{item.available.toLocaleString()}</strong> available / {item.total.toLocaleString()} recorded slots</p><div className="sr-bar" role="img" aria-label={`${item.available} available of ${item.total} slots`}><span style={{ width: `${item.total ? item.available / item.total * 100 : 0}%` }} /></div><small>{item.occupied.toLocaleString()} occupied · Remaining slots may be reserved, under maintenance, or have another status.</small></article>)}</div>
    <div className="sr-tabs" role="group" aria-label="Staff report category">{Object.entries(categories).map(([key, item]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setPage(0); }}>{item.title}<span>{data[key].length.toLocaleString()}</span></button>)}</div>
    <h3>{definition.title}</h3><p className="sr-note">{definition.note}</p>
    {tab === 'sections' && <div className="sr-inventory-controls">
      <div className="sr-cemetery-switch" role="group" aria-label="Slot inventory cemetery">
        {['old', 'new'].map(code => <button type="button" key={code} aria-pressed={inventoryCemetery === code} onClick={() => { setInventoryCemetery(code); setPage(0); }}>{code === 'old' ? 'Old' : 'New'} Cemetery</button>)}
      </div>
      <p aria-live="polite"><strong>{inventoryCemetery === 'old' ? 'Old' : 'New'} Cemetery</strong> · {inventorySummary.total.toLocaleString()} total slots · {inventorySummary.available.toLocaleString()} available · {inventorySummary.occupied.toLocaleString()} occupied</p>
    </div>}
    <div className="sr-table"><table><thead><tr>{definition.columns.map(([key, title]) => <th key={key} scope="col">{title}</th>)}</tr></thead><tbody>{rows.slice(currentPage * 10, currentPage * 10 + 10).map((row, index) => <tr key={index}>{definition.columns.map(([key]) => <td key={key}>{key === 'cemetery' ? (row[key] === 'old' ? 'Old Cemetery' : 'New Cemetery') : (row[key] ?? '—')}</td>)}</tr>)}{!rows.length && <tr><td colSpan={definition.columns.length}>No records in this report category.</td></tr>}</tbody></table></div>
    <div className="sr-pagination"><span>{rows.length.toLocaleString()} records · 10 per page</span><div><button type="button" className="btn btn-ghost btn-sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button type="button" className="btn btn-ghost btn-sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
  </section>;
}
