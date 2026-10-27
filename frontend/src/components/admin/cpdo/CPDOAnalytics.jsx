import { memo, useMemo, useState } from 'react';
import './CPDOAnalytics.css';
import { activeInventoryForZones, buildStackInventory } from '../../../utils/cpdoInventory.js';
import { planningSectionStatusCounts } from '../../../utils/planningSections.js';

const COLORS = { occupied: '#ed8956', available: '#1687c9', maintenance: '#8491aa', partial: '#e9af58', other: '#aa85bf' };
const NAME = { old: 'Old Cemetery', new: 'New Cemetery' };

function summarize(rows) {
  const counts = { occupied: 0, available: 0, maintenance: 0, partial: 0, other: 0, total: rows.length };
  rows.forEach(row => { const status = String(row.status || '').toLowerCase(); counts[Object.hasOwn(counts, status) ? status : 'other']++; });
  counts.rate = counts.total ? Math.round(counts.occupied / counts.total * 100) : 0;
  return counts;
}

function Legend() {
  return <div className="cpdo-legend">{Object.entries(COLORS).map(([name, color]) => <span key={name}><i style={{ background: color }} />{name === 'partial' ? 'partly occupied' : name}</span>)}</div>;
}

function Donut({ counts, label }) {
  const occupied = counts.total ? counts.occupied / counts.total * 100 : 0;
  const available = counts.total ? occupied + counts.available / counts.total * 100 : 0;
  const maintenance = counts.total ? available + counts.maintenance / counts.total * 100 : 0;
  const partial = counts.total ? maintenance + counts.partial / counts.total * 100 : 0;
  const fill = counts.total ? `conic-gradient(${COLORS.occupied} 0 ${occupied}%, ${COLORS.available} ${occupied}% ${available}%, ${COLORS.maintenance} ${available}% ${maintenance}%, ${COLORS.partial} ${maintenance}% ${partial}%, ${COLORS.other} ${partial}% 100%)` : 'var(--border)';
  return <div className="cpdo-donut" style={{ '--fill': fill }} role="img" aria-label={counts.total ? `${label}: ${counts.occupied} of ${counts.total} occupied` : `${label}: no registered units`}><div><strong>{counts.total ? `${counts.rate}%` : '—'}</strong><small>{counts.total ? 'occupied' : 'no records'}</small></div></div>;
}

function CPDOAnalytics({ inventoryRows, sectionsByCemetery }) {
  const [activeCemetery, setActiveCemetery] = useState('old');
  const data = useMemo(() => {
    const inventory = inventoryRows.filter(row => row.kind === 'niche');
    const nicheRows = ['old', 'new'].flatMap(code => activeInventoryForZones(inventory, sectionsByCemetery[code], code));
    const stackRows = buildStackInventory(nicheRows);
    const cemetery = ['old', 'new'].map(code => ({ code,
      ground: summarize(stackRows.filter(row => row.cemeteryCode === code)),
      niches: summarize(nicheRows.filter(row => row.cemeteryCode === code)) }));
    const group = (rows, getCode, getName) => {
      const map = new Map();
      rows.forEach(row => { const code = getCode(row) || 'old'; const name = getName(row) || 'Unassigned'; const key = `${code}:${name}`; if (!map.has(key)) map.set(key, { key, code, name, rows: [] }); map.get(key).rows.push(row); });
      return [...map.values()].map(row => ({ ...row, counts: summarize(row.rows) })).sort((a, b) => b.counts.total - a.counts.total || a.name.localeCompare(b.name));
    };
    const ground = group(stackRows, row => row.cemeteryCode, row => row.sectionName);
    const niches = group(nicheRows, row => row.cemeteryCode, row => row.sectionName);
    const zonesByCemetery = {
      old: planningSectionStatusCounts(sectionsByCemetery.old),
      new: planningSectionStatusCounts(sectionsByCemetery.new),
    };
    return { cemetery, ground, niches, zonesByCemetery };
  }, [inventoryRows, sectionsByCemetery]);
  const selectedCemetery = data.cemetery.find(row => row.code === activeCemetery) || data.cemetery[0];
  const ground = selectedCemetery.ground;
  const niches = selectedCemetery.niches;
  const activeZones = data.zonesByCemetery[activeCemetery];
  const zoneTotal = Object.values(activeZones).reduce((sum, count) => sum + count, 0);
  const activeGround = data.ground.filter(row => row.code === activeCemetery);
  const activeNiches = data.niches.filter(row => row.code === activeCemetery);
  const largestGround = Math.max(1, ...activeGround.map(row => row.counts.total));
  const largestNiche = Math.max(1, ...activeNiches.map(row => row.counts.total));
  const ranked = activeNiches.filter(row => row.counts.total >= 5).sort((a, b) => b.counts.rate - a.counts.rate || b.counts.occupied - a.counts.occupied).slice(0, 5);
  const zoneColors = { active: '#1687c9', planned: '#e9af58', maintenance: '#8491aa', unknown: '#aa85bf' };
  let progress = 0;
  const zoneGradient = Object.entries(activeZones).map(([name, count]) => { const start = progress; progress += zoneTotal ? count / zoneTotal * 100 : 0; return `${zoneColors[name]} ${start}% ${progress}%`; }).join(', ');

  return <div className="cpdo-analytics">
    <div className="cpdo-intro"><div><span className="cpdo-eyebrow">CAPACITY OVERVIEW</span><h2>{NAME[activeCemetery]} analytics</h2><p>Stack positions and their individual niches across active sections of the selected cemetery.</p></div><div className="cpdo-intro-actions"><div className="cpdo-cemetery-switcher" role="tablist" aria-label="Select cemetery analytics">{['old', 'new'].map(code => <button key={code} type="button" role="tab" aria-selected={activeCemetery === code} className={activeCemetery === code ? 'active' : ''} onClick={() => setActiveCemetery(code)}>{NAME[code]}</button>)}</div><span className="cpdo-live">{NAME[activeCemetery]}</span></div></div>
    <div className="cpdo-kpis">
      <div><span>Stack positions</span><strong>{ground.total.toLocaleString()}</strong><small>Vertical columns of niches</small></div>
      <div><span>Apartment niches</span><strong>{niches.total.toLocaleString()}</strong><small>{niches.available.toLocaleString()} available</small></div>
      <div><span>Sections</span><strong>{zoneTotal}</strong><small>{activeZones.active} active · {activeZones.planned} planned · {activeZones.maintenance} maintenance{activeZones.unknown > 0 ? ` · ${activeZones.unknown} unknown` : ''}</small></div>
      <div className="cpdo-kpi-highlight"><span>Niche occupancy</span><strong>{niches.rate}%</strong><small>{niches.occupied} of {niches.total} niches occupied</small></div>
    </div>
    <div className="cpdo-grid" key={activeCemetery}>
      <section className="planning-card cpdo-panel cpdo-compare"><header><span className="cpdo-eyebrow">{NAME[activeCemetery].toUpperCase()}</span><h3>{NAME[activeCemetery]} inventory</h3><p>Occupied share of the selected cemetery's registered inventory.</p></header><div className="cpdo-cemeteries"><div className="cpdo-cemetery"><h4>{NAME[activeCemetery]}</h4><p className="cpdo-map-count">{zoneTotal} sections in this cemetery</p><div className="cpdo-donut-pair">{[['Stack positions', ground], ['Apartment niches', niches]].map(([label, counts]) => <div key={label}><Donut counts={counts} label={`${NAME[activeCemetery]} ${label}`} /><b>{label}</b><span>{counts.total ? `${counts.occupied} / ${counts.total} occupied` : 'No registered units'}</span><small>{counts.total ? `${counts.available} available` : activeCemetery === 'new' && label === 'Stack positions' ? 'Map layout only' : 'No inventory yet'}</small></div>)}</div></div></div><Legend /></section>
      <section className="planning-card cpdo-panel cpdo-zone-panel"><header><span className="cpdo-eyebrow">ZONING</span><h3>{NAME[activeCemetery]} section status</h3><p>All current sections, including existing map sections. Archived and deleted sections are excluded.</p></header>{zoneTotal ? <><div className="cpdo-zone-donut" role="img" aria-label={NAME[activeCemetery] + ': ' + zoneTotal + ' sections. ' + Object.entries(activeZones).map(([name, count]) => count + ' ' + name).join(', ')} style={{ '--fill': `conic-gradient(${zoneGradient})` }}><div><strong>{zoneTotal}</strong><small>sections</small></div></div><div className="cpdo-zone-key">{Object.entries(activeZones).filter(([name, count]) => name !== 'unknown' || count > 0).map(([name, count]) => <div key={name}><i style={{ background: zoneColors[name] }} /><span>{name}</span><b>{count}</b></div>)}</div></> : <p className="cpdo-empty">No current sections.</p>}</section>
      <section className="planning-card cpdo-panel cpdo-ground-panel"><header><span className="cpdo-eyebrow">STACK POSITIONS</span><h3>{NAME[activeCemetery]} stacks by section</h3><p>One position per niche column. Available means all its niches are available; occupied means all are occupied.</p></header>{activeGround.length ? <div className="cpdo-ground-chart">{activeGround.map((row, index) => <div className="cpdo-ground-row" key={row.key} style={{ '--cpdo-delay': Math.min(index, 9) * 45 + 'ms' }}><div className="cpdo-row-name"><b>{row.name}</b><small>{NAME[activeCemetery]}</small></div><div className="cpdo-ground-area"><div className="cpdo-ground-bar" style={{ width: `${row.counts.total / largestGround * 100}%` }} role="img" aria-label={`${row.name}: ${row.counts.occupied} occupied, ${row.counts.available} available, ${row.counts.maintenance} maintenance`}>{Object.entries(COLORS).map(([status, color]) => row.counts[status] > 0 && <span key={status} title={`${row.counts[status]} ${status}`} style={{ width: `${row.counts[status] / row.counts.total * 100}%`, background: color }} />)}</div></div><b className="cpdo-row-count">{row.counts.total}</b></div>)}</div> : <p className="cpdo-empty">No stack positions recorded yet.</p>}<Legend /></section>
      <section className="planning-card cpdo-panel cpdo-niche-panel"><header><span className="cpdo-eyebrow">APARTMENT INVENTORY</span><h3>{NAME[activeCemetery]} niches by section</h3><p>Recorded slot counts by building section.</p></header>{activeNiches.length ? <div className="cpdo-niche-chart">{activeNiches.map((row, index) => <div className="cpdo-niche-column" key={row.key} style={{ '--cpdo-delay': Math.min(index, 9) * 45 + 'ms' }} title={`${row.name}: ${row.counts.occupied} occupied, ${row.counts.available} available`}><b>{row.counts.total}</b><div className="cpdo-niche-bar" style={{ height: `${Math.max(8, row.counts.total / largestNiche * 100)}%` }}>{Object.entries(COLORS).map(([status, color]) => row.counts[status] > 0 && <span key={status} style={{ height: `${row.counts[status] / row.counts.total * 100}%`, background: color }} />)}</div><div className="cpdo-niche-name"><strong>{row.name}</strong><small>{NAME[activeCemetery]}</small></div></div>)}</div> : <p className="cpdo-empty">No recorded apartment niches yet.</p>}<Legend /></section>
      <section className="planning-card cpdo-panel cpdo-ranked"><header><span className="cpdo-eyebrow">PRIORITY VIEW</span><h3>Most occupied niche sections</h3><p>Sections with at least five recorded niches.</p></header>{ranked.length ? <div className="cpdo-rank-list">{ranked.map((row, index) => <div key={row.key} style={{ '--cpdo-delay': index * 55 + 'ms' }}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{row.name}</b><small>{NAME[row.code]} / {row.counts.occupied} of {row.counts.total} niches</small></div><strong>{row.counts.rate}%</strong></div>)}</div> : <p className="cpdo-empty">No section has at least five recorded niches yet.</p>}</section>
    </div>
    <p className="cpdo-method">Stack positions group niches by section and column, including sections without saved ground layouts. Stacks are not additional burial spaces. Niche occupancy = occupied niches / recorded niches; stack occupancy means every niche in a stack is occupied.</p>
  </div>;
}

export default memo(CPDOAnalytics);
