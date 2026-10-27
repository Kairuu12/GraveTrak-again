import { useState } from 'react';

const PAGE_SIZE = 10;

export default function ReportApplications({ report }) {
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const all = report.application_records || [];
  const rows = all.filter(row => (!status || row.status_code === status) && `${row.id} ${row.deceased_name} ${row.applicant_name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  return <section style={{ margin: '24px 0', padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }}>
    <h3 style={{ marginTop: 0 }}>Application Status & Activity</h3>
    <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>Applications submitted, approved, rejected, or scheduled for an appointment or burial during the selected period. Each application appears once. Statuses reflect the records when this report was generated.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button className={`btn btn-sm ${!status ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={!status} onClick={() => { setStatus(''); setPage(0); }}>All ({all.length})</button>
      {(report.application_statuses || []).map(item => <button key={item.code} className={`btn btn-sm ${status === item.code ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={status === item.code} onClick={() => { setStatus(item.code); setPage(0); }}>{item.label} ({item.count})</button>)}
    </div>
    <input type="search" className="field-input" aria-label="Search report applications" placeholder="Search application ID, deceased, or applicant…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 16 }} />
    <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr>{['Application', 'Deceased', 'Applicant', 'Current status', 'Submitted', 'Approved', 'Rejected', 'Burial date'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <tr key={row.id}><td>{row.id}</td><td><strong>{row.deceased_name}</strong></td><td>{row.applicant_name}</td><td>{row.status}</td>{['submitted_date', 'approved_date', 'rejected_date', 'burial_date'].map(key => <td key={key} style={{ whiteSpace: 'nowrap' }}>{row[key] || '—'}</td>)}</tr>)}{!rows.length && <tr><td colSpan={8}>No applications match this period and filter.</td></tr>}</tbody></table></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 16 }}><span style={{ fontSize: 12 }}>{rows.length} matching applications · Page {current + 1} of {pageCount}</span><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-ghost btn-sm" disabled={!current} onClick={() => setPage(current - 1)}>Previous</button><button className="btn btn-ghost btn-sm" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)}>Next</button></div></div>
  </section>;
}
