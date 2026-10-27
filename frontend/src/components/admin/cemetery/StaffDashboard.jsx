import { useEffect, useMemo, useRef, useState } from 'react';
import { memorialLabel } from './ApartmentNicheWall.jsx';
import { summarizeStaffInventory, SLOT_STATUSES } from '../../../utils/staffDashboard.js';
import './StaffDashboard.css';

const LABELS = { available: 'Available', occupied: 'Occupied', reserved: 'Reserved', maintenance: 'Maintenance', other: 'Other status' };
const COLORS = { available: '#159e91', occupied: '#1687c9', reserved: '#d49a29', maintenance: '#de6d65', other: '#94a3b8' };
const number = value => value.toLocaleString();
const percent = value => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
function AnimatedNumber({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame;
    let observer;
    const finish = () => { cancelAnimationFrame(frame); element.textContent = number(value); };
    const start = () => {
      if (motion.matches) { finish(); return; }
      const began = performance.now();
      const tick = now => {
        const progress = Math.min(1, (now - began) / 1400);
        element.textContent = number(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const onMotionChange = () => { if (motion.matches) finish(); };
    if (motion.matches || !('IntersectionObserver' in window)) finish();
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
      }, { threshold: 0.5 });
      observer.observe(element);
    }
    motion.addEventListener('change', onMotionChange);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); motion.removeEventListener('change', onMotionChange); };
  }, [value]);
  return <span aria-label={number(value)}><span ref={ref} aria-hidden="true">{number(value)}</span></span>;
}
function Icon({ name }) {
  const paths = { grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', check: 'm5 12 4 4L19 6', person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2', alert: 'M12 8v5 M12 17h.01 M12 3 2 21h20Z', arrow: 'M5 12h14 m-6-6 6 6-6 6', map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z M9 3v16 M15 5v16', file: 'M5 3h10l4 4v14H5Z M9 11h6 M9 15h6' };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.grid} /></svg>;
}
function Pager({ page, pages, onChange, label }) {
  return <nav className="sd-pager" aria-label={label}><button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button><span>{page + 1} / {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next</button></nav>;
}
export default function StaffDashboard({ slots, groundPlots = [], groundPlotError = '', groundPlotsLoading = false, cemetery, onCemeteryChange, onSection, onReview, onRecords, onMap, onNiches }) {
  const dashboardRef = useRef(null);
  useEffect(() => {
    const panels = dashboardRef.current.querySelectorAll('.sd-enter');
    if (!('IntersectionObserver' in window)) { panels.forEach(panel => panel.classList.add('sd-in-view')); return; }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('sd-in-view'); observer.unobserve(entry.target); } });
    }, { threshold: 0.08 });
    panels.forEach(panel => observer.observe(panel));
    return () => observer.disconnect();
  }, [cemetery]);
  const [queue, setQueue] = useState('review');
  const [queuePage, setQueuePage] = useState(0);
  const [sectionPage, setSectionPage] = useState(0);
  const [search, setSearch] = useState('');
  const data = useMemo(() => summarizeStaffInventory(slots, groundPlots, cemetery), [slots, groundPlots, cemetery]);
  const reviews = useMemo(() => data.occupied.flatMap(slot => {
    const people = String(slot.name || '').split(/,\s*(?!\d)/).filter(Boolean).map(name => memorialLabel({ name }));
    const missingName = !people.length || people.some(person => !person.name);
    const missingDate = !people.length || people.some(person => !person.deathDate);
    return missingName || missingDate ? [{ slot, reason: [missingName && 'Missing name', missingDate && 'Missing death date'].filter(Boolean).join(' · ') }] : [];
  }), [data]);
  const queueItems = useMemo(() => queue === 'review' ? reviews : data.maintenance.map(slot => ({ slot, reason: slot.maintenance_notes || 'Marked for maintenance' })), [queue, reviews, data]);
  const queuePages = Math.max(1, Math.ceil(queueItems.length / 4));
  const currentQueuePage = Math.min(queuePage, queuePages - 1);
  const sections = useMemo(() => data.sections.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase())), [data.sections, search]);
  const sectionPages = Math.max(1, Math.ceil(sections.length / 6));
  const currentSectionPage = Math.min(sectionPage, sectionPages - 1);
  const complete = data.occupied.length - reviews.length;
  const completeness = data.occupied.length ? complete / data.occupied.length * 100 : null;
  let position = 0;
  const segments = SLOT_STATUSES.map(status => {
    const start = position;
    position += data.totals.total ? data.totals[status] / data.totals.total * 100 : 0;
    return { status, start, size: position - start };
  });
  const cards = [
    { label: 'Total slots', value: data.totals.total, detail: 'Individual niche records', icon: 'grid', tone: 'blue' },
    { label: 'Available slots', value: data.totals.available, detail: 'Recorded as available', icon: 'check', tone: 'green' },
    { label: 'Occupied slots', value: data.totals.occupied, detail: `${percent(data.occupancy)}% of recorded slots`, icon: 'person', tone: 'blue' },
    { label: 'Records to review', value: reviews.length, detail: 'Missing name or death date', icon: 'alert', tone: 'amber' },
  ];
  return <div ref={dashboardRef} className="staff-dashboard sd-v2">
    <header className="sd-header"><div><span className="sd-eyebrow">CEMETERY OPERATIONS</span><h1>Your operations overview</h1><p>Availability, record checks, and maintenance in one place.</p></div><div className="sd-cemetery" role="group" aria-label="Dashboard cemetery">{['old', 'new'].map(code => <button key={code} type="button" aria-pressed={cemetery === code} onClick={() => { onCemeteryChange(code); setQueuePage(0); setSectionPage(0); setSearch(''); }}>{code === 'old' ? 'Old' : 'New'} Cemetery</button>)}</div></header>
    {groundPlotError && <p className="sd-error" role="alert">Some inventory could not be loaded: {groundPlotError} Counts may be incomplete.</p>}
    <div className="sd-content" key={cemetery}>
      <section className="sd-hero sd-enter"><div><span className="sd-eyebrow">{cemetery === 'old' ? 'OLD' : 'NEW'} CEMETERY</span><h2>A clearer view of your cemetery.</h2><p>{number(data.sections.length)} sections with niche records. Check availability and keep records up to date.</p></div><button type="button" onClick={() => onMap(cemetery)}><Icon name="map" />Open cemetery map<Icon name="arrow" /></button></section>
      <section className="sd-kpis" aria-label="Niche inventory summary">{cards.map((card, index) => <article key={card.label} className={`sd-kpi sd-enter sd-${card.tone}`} style={{ '--delay': `${index * 45}ms` }}><div className="sd-kpi-label"><h2>{card.label}</h2><span><Icon name={card.icon} /></span></div><strong><AnimatedNumber value={card.value} /></strong><p>{card.detail}</p></article>)}</section>
      <div className="sd-main-grid">
        <section className="sd-card sd-enter" style={{ '--delay': '120ms' }}><header className="sd-card-head"><div><span className="sd-eyebrow">CAPACITY</span><h2>Slot availability</h2></div><span className="sd-chip">{percent(data.occupancy)}% occupied</span></header>
          <div className="sd-capacity"><div className="sd-donut" role="img" aria-label={data.totals.total ? SLOT_STATUSES.map(status => `${number(data.totals[status])} ${LABELS[status]}`).join(', ') : 'No slots loaded'}>
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="sd-ring-base" cx="60" cy="60" r="52" />{segments.filter(segment => segment.size > 0).map(segment => <circle key={`${segment.status}:${segment.size}`} className="sd-ring-segment" cx="60" cy="60" r="52" pathLength="100" stroke={COLORS[segment.status]} strokeDasharray={`${segment.size} ${100 - segment.size}`} strokeDashoffset={-segment.start} style={{ '--segment-size': segment.size, '--segment-rest': 100 - segment.size }} />)}</svg>
            <div><strong><AnimatedNumber value={data.totals.total} /></strong><span>Total slots</span></div></div>
            <dl className="sd-legend">{SLOT_STATUSES.filter(status => status !== 'other' || data.totals.other).map(status => <div key={status}><dt><i style={{ background: COLORS[status] }} />{LABELS[status]}</dt><dd>{number(data.totals[status])}<small>{percent(data.totals.total ? data.totals[status] / data.totals.total * 100 : 0)}%</small></dd></div>)}</dl>
          </div><p className="sd-note">Capacity counts individual niches. Saved ground layouts are not added to this total.</p>
          <div className="sd-quality"><div><strong>Occupied record completeness</strong><span>{completeness === null ? 'No occupied records' : `${percent(completeness)}%`}</span></div><div className="sd-quality-track"><span style={{ width: `${completeness ?? 0}%` }} /></div><p>{number(complete)} of {number(data.occupied.length)} occupied records have a recorded name and death date.</p></div>
        </section>
        <section className="sd-card sd-enter" style={{ '--delay': '160ms' }}><header className="sd-card-head"><div><span className="sd-eyebrow">FOLLOW-UP</span><h2>Needs attention</h2></div><Icon name="alert" /></header>
          <div className="sd-tabs" role="group" aria-label="Follow-up category">{[['review', 'Record checks', reviews.length], ['maintenance', 'Niche maintenance', data.maintenance.length]].map(([key, label, total]) => <button key={key} type="button" aria-pressed={queue === key} onClick={() => { setQueue(key); setQueuePage(0); }}>{label}<span>{number(total)}</span></button>)}</div>
          <div className="sd-queue sd-switch-enter" key={`${queue}:${currentQueuePage}`} aria-live="polite">{queueItems.slice(currentQueuePage * 4, currentQueuePage * 4 + 4).map(({ slot, reason }) => <article key={slot.id}><div><strong>{queue === 'review' ? memorialLabel(slot).name || 'Unnamed occupant' : slot.section}</strong><span>{slot.section} · Floor {slot.floor} · Column {slot.col}</span><p>{reason}</p></div><button type="button" className="sd-small-action" onClick={() => onReview(slot)}>Review<Icon name="arrow" /></button></article>)}{!queueItems.length && <div className="sd-empty"><Icon name="check" /><strong>{groundPlotError ? 'No items in the loaded records' : queue === 'review' ? 'No incomplete records found' : 'No niche maintenance recorded'}</strong><p>{queue === 'review' ? 'Checks cover names and death dates in loaded occupied records.' : 'Niches marked for maintenance appear here.'}</p></div>}</div>
          {queuePages > 1 && <Pager page={currentQueuePage} pages={queuePages} onChange={setQueuePage} label="Follow-up pages" />}
        </section>
      </div>
      <div className="sd-lower-grid">
        <section className="sd-card sd-enter" style={{ '--delay': '200ms' }}><header className="sd-card-head"><div><span className="sd-eyebrow">SECTION BREAKDOWN</span><h2>Where space is available</h2></div><label className="sd-search"><span className="sd-sr-only">Search sections</span><input type="search" placeholder="Find a section…" value={search} onChange={event => { setSearch(event.target.value); setSectionPage(0); }} /></label></header>
          <div className="sd-chart-key">{SLOT_STATUSES.filter(status => status !== 'other' || data.totals.other).map(status => <span key={status}><i style={{ background: COLORS[status] }} />{LABELS[status]}</span>)}</div>
          <div className="sd-sections sd-switch-enter" key={currentSectionPage}>{sections.slice(currentSectionPage * 6, currentSectionPage * 6 + 6).map(section => <button type="button" key={section.name} className="sd-section" onClick={() => onSection(section.name, cemetery)} aria-label={`${section.name}: ${section.available} available of ${section.total} slots. Open section.`}><div><strong>{section.name}</strong><span>{number(section.available)} <small>/ {number(section.total)} available</small><Icon name="arrow" /></span></div><div className="sd-section-track" aria-hidden="true">{SLOT_STATUSES.map(status => <span key={status} style={{ width: `${section.total ? section[status] / section.total * 100 : 0}%`, background: COLORS[status] }} />)}</div></button>)}</div>
          {!sections.length && <p className="sd-note">{search ? 'No sections match your search.' : 'No niche sections loaded for this cemetery.'}</p>}
          {sectionPages > 1 && <Pager page={currentSectionPage} pages={sectionPages} onChange={setSectionPage} label="Section chart pages" />}
        </section>
        <aside className="sd-side-column">
          <section className="sd-card sd-enter" style={{ '--delay': '240ms' }}><header className="sd-card-head"><div><span className="sd-eyebrow">MAP MAINTENANCE</span><h2>Layout follow-up</h2></div><Icon name="map" /></header>
            {groundPlotsLoading ? <p className="sd-note" role="status">Loading layout records…</p> : groundPlotError ? <p className="sd-note">Layout totals are unavailable. Reload the dashboard to retry.</p> : <><div className="sd-maintenance-total"><strong>{number(data.layouts.maintenance)}</strong><span>layout records marked<br />for maintenance</span></div>{data.layoutMaintenance.slice(0, 3).map(plot => <div className="sd-layout-item" key={plot.id}><strong>{plot.plot_id}</strong><span>{plot.section_name || plot.section}</span></div>)}<p className="sd-note">Tracks saved map layouts separately from niche capacity.</p></>}
            <button type="button" className="sd-text-action" onClick={() => onMap(cemetery)}>Open map<Icon name="arrow" /></button>
          </section>
          <section className="sd-shortcuts sd-enter" style={{ '--delay': '280ms' }} aria-label="Quick actions"><h2>Quick actions</h2>{[['file', 'Find a record', 'Search names and burial details', onRecords], ['grid', 'Browse apartment niches', 'Open sections, floors, and slots', onNiches]].map(([icon, title, caption, action]) => <button key={title} type="button" onClick={() => action(cemetery)}><Icon name={icon} /><span><strong>{title}</strong><small>{caption}</small></span><Icon name="arrow" /></button>)}</section>
        </aside>
      </div>
      <p className="sd-footer">Based on loaded inventory for {cemetery === 'old' ? 'Old' : 'New'} Cemetery. Record checks identify missing details; they do not change occupancy.</p>
    </div>
  </div>;
}
