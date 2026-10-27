import { useEffect, useState } from 'react';
import { fetchOperationsReports, submitOperationsReport, acknowledgeOperationsReport } from '../../../api.js';
import { downloadReportWorkbook } from '../../../utils/reportWorkbook.js';
import ReportApplications from './ReportApplications.jsx';
import CemeteryReports from './CemeteryReports.jsx';

export default function ReportSubmissions({ role, analytics, canSubmit }) {
  const [reports, setReports] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [compose, setCompose] = useState(false);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const data = await fetchOperationsReports(controller.signal);
        if (!controller.signal.aborted) { setReports(data); setError(''); }
      } catch (err) { if (!controller.signal.aborted) setError(err.message); }
      finally { running = false; if (!controller.signal.aborted) setLoading(false); }
    }
    load(); const timer = setInterval(load, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  async function submit() {
    if (busy || !canSubmit || !analytics) return;
    setBusy(true); setError('');
    try {
      const report = await submitOperationsReport({ title: `Cemetery Operations · ${analytics.from} to ${analytics.to}`, period_from: analytics.from, period_to: analytics.to, notes });
      setReports(items => [report, ...items.filter(item => item.id !== report.id)]);
      setCompose(false); setNotes(''); setTab('pending'); setMessage('Report submitted to the Mayor’s Office.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function acknowledge(report) {
    setBusy(true); setError('');
    try {
      const updated = await acknowledgeOperationsReport(report.id);
      setReports(items => items.map(item => item.id === updated.id ? updated : item));
      setTab('acknowledged'); setMessage('Report acknowledged.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section style={{ marginTop: 28 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}><div><h3 style={{ margin: '0 0 6px' }}>Submitted Operations Reports</h3><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{role === 'staff' ? 'Your submitted reports and acknowledgments from the Mayor’s Office.' : 'Reports submitted by Cemetery Staff for your review.'} These submissions are separate from the period’s burial records.</p></div><div style={{ display: 'flex', gap: 8, alignItems: 'start' }}><button className="btn btn-ghost btn-sm" onClick={() => setRefresh(value => value + 1)}>Refresh</button>{role === 'staff' && <button className="btn btn-primary btn-sm" disabled={!canSubmit || busy} onClick={() => { setCompose(true); setMessage(''); }}>Submit Generated Report</button>}</div></div>
    {role === 'staff' && !canSubmit && !compose && <p role="status" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Generate the selected report and wait for it to finish loading before submitting. Leave both dates empty for Overall.</p>}
    {compose && role === 'staff' && <div style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16, background: 'var(--bg-card)' }}>
      <h4>Submit to Mayor’s Office</h4><p>Period: {analytics?.from} to {analytics?.to}</p><p style={{ fontSize: 12 }}>The server will save the current figures and burial records for this period. This report will appear as Pending.</p>
      <label htmlFor="report-submission-notes">Optional notes</label><textarea id="report-submission-notes" maxLength={10000} value={notes} onChange={event => setNotes(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 100, margin: '8px 0 16px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }} />
      {!canSubmit && <p>Generate the selected period before submitting.</p>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" disabled={busy || !canSubmit} onClick={submit}>{busy ? 'Submitting…' : 'Confirm Submission'}</button><button className="btn btn-ghost" disabled={busy} onClick={() => setCompose(false)}>Cancel</button></div>
    </div>}
    {error && <p role="alert" className="application-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>{['pending', 'acknowledged'].map(status => <button key={status} className={`btn btn-sm ${tab === status ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={tab === status} onClick={() => setTab(status)}>{status === 'pending' ? 'Pending' : 'Acknowledged'} ({reports.filter(report => report.status === status).length})</button>)}</div>
    {loading ? <p role="status">Loading submitted reports…</p> : reports.filter(report => report.status === tab).map(report => <details key={report.id} style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
      <summary style={{ cursor: 'pointer' }}><strong>{report.title}</strong><div style={{ fontSize: 12, marginTop: 8, color: 'var(--text-secondary)' }}>Report #{report.id} · {report.author} · {new Date(report.submitted_at).toLocaleString()}</div></summary>
      <p>Period: {report.period_from} to {report.period_to}</p>
      <ul>{Object.entries(report.snapshot.metrics || {}).map(([key, value]) => <li key={key}>{key.replaceAll('_', ' ')}: <strong>{value}</strong></li>)}</ul>
      {report.notes && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.notes}</p>}
      {report.snapshot.staff_operations ? <CemeteryReports report={report.snapshot} /> : report.snapshot.application_records && <ReportApplications report={report.snapshot} />}
      {report.acknowledged_at && <p>Acknowledged by {report.acknowledged_by_name} · {new Date(report.acknowledged_at).toLocaleString()}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await downloadReportWorkbook({ ...report.snapshot, from: report.period_from, to: report.period_to }, 'staff'); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>Export Submitted Excel</button>{role === 'mayor' && report.status === 'pending' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => acknowledge(report)}>Acknowledge Report</button>}</div>
    </details>)}
    {!loading && !error && !reports.some(report => report.status === tab) && <p style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-secondary)' }}>{tab === 'pending' ? 'No pending submissions.' : 'No reports acknowledged yet.'}{role === 'staff' && tab === 'pending' ? ' Generate a report above, then choose Submit Generated Report.' : ''}</p>}
  </section>;
}
