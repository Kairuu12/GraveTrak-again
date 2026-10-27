import { memo, useEffect, useMemo, useRef, useState } from 'react';
import './ApartmentNicheWall.css';

export function memorialLabel(record) {
  const name = String(record?.name || '').trim();
  // Existing assignments store lifespan dates in the name. Split only that
  // recognized suffix; preserve the original record and date notation.
  const match = name.match(/^(.*?)\s+\(([\d/?.,\s-]+)\s+[-–]\s+([\d/?.,\s-]+)\)$/);
  const deathDate = match?.[3]?.trim();
  return {
    name: match ? match[1].trim() : name,
    deathDate: deathDate && /\d/.test(deathDate) ? deathDate : '',
  };
}

function ApartmentNicheWall({ groups, floors, slots, section, cemetery, filter, doubleSided, slotsPerSide, normalizeSectionName, onSelect, focusTarget, selectableStatus }) {
  const trackRef = useRef(null);
  const [columnsPerSlide, setColumnsPerSlide] = useState(8);
  const [activeSlide, setActiveSlide] = useState(0);
  const slides = useMemo(
    () => groups.flatMap((group, side) => Array.from({ length: Math.ceil(group.length / columnsPerSlide) }, (_, bay) => ({ side, columns: group.slice(bay * columnsPerSlide, (bay + 1) * columnsPerSlide) }))),
    [groups, columnsPerSlide]
  );
  const layoutKey = `${cemetery}:${section}:${columnsPerSlide}:${groups.map(group => group.join(',')).join('|')}`;
  const [highlight, setHighlight] = useState(null);
  useEffect(() => {
    const track = trackRef.current;
    const observer = new ResizeObserver(([entry]) => {
      setColumnsPerSlide(Math.max(1, Math.min(8, Math.floor((entry.contentRect.width - 84) / 112))));
    });
    if (track) observer.observe(track);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setActiveSlide(0);
    trackRef.current?.scrollTo({ left: 0, behavior: 'instant' });
  }, [layoutKey]);
  useEffect(() => {
    if (!focusTarget || focusTarget.cemeteryMap !== cemetery || normalizeSectionName(focusTarget.section) !== normalizeSectionName(section)) return;
    const index = slides.findIndex(slide => slide.columns.includes(Number(focusTarget.col)));
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      const track = trackRef.current;
      track?.scrollTo({ left: index * track.clientWidth, behavior: 'instant' });
      setActiveSlide(index);
      setHighlight(`${focusTarget.floor}:${focusTarget.col}`);
      track?.querySelectorAll('.niche-slide')[index]?.querySelector(`[data-niche-position="${Number(focusTarget.floor)}:${Number(focusTarget.col)}"]`)?.focus({ preventScroll: true });
    });
    const timer = setTimeout(() => setHighlight(null), 5000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [focusTarget, layoutKey]);
  const goToSlide = index => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(slides.length - 1, index));
    track.scrollTo({ left: target * track.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const records = useMemo(
    () => new Map(slots.filter(s => normalizeSectionName(s.section) === normalizeSectionName(section) && s.cemeteryMap === cemetery).map(s => [`${Number(s.floor)}:${Number(s.col)}`, s])),
    [slots, section, cemetery, normalizeSectionName]
  );
  const columnLabel = col => doubleSided && col > slotsPerSide ? col - slotsPerSide : col;
  return <div className="niche-walls">
    <div className="niche-wall-guide"><strong>Apartment Niches · {section}</strong><span>Front elevation · Highest floor at the top. {selectableStatus === 'available' ? 'Select an available niche as the transfer destination.' : 'Select a niche to view its record.'}</span></div>
    <div className="niche-wall-legend">{['available', 'occupied', 'maintenance'].map(status => <span key={status}><i className={status} />{status.charAt(0).toUpperCase() + status.slice(1)}</span>)}</div>
    <div className="niche-slide-controls">
      <button type="button" className="btn btn-ghost btn-sm" disabled={activeSlide === 0} onClick={() => goToSlide(activeSlide - 1)}>← Previous</button>
      <span aria-live="polite">{slides.length ? `Group ${Math.min(activeSlide + 1, slides.length)} of ${slides.length}` : 'No groups'}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={activeSlide >= slides.length - 1} onClick={() => goToSlide(activeSlide + 1)}>Next →</button>
    </div>
    <div className="niche-slide-track" ref={trackRef} role="region" aria-label="Apartment niche groups. Swipe or use Previous and Next." tabIndex={0}
      onKeyDown={event => { if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); goToSlide(activeSlide + (event.key === 'ArrowRight' ? 1 : -1)); } }}
      onScroll={event => { const track = event.currentTarget; if (track.clientWidth) setActiveSlide(Math.round(track.scrollLeft / track.clientWidth)); }}>
      {slides.map(({ columns, side }, index) => {
        return <section className="niche-bay niche-slide" key={`${layoutKey}:${index}`} aria-label={`Group ${index + 1} of ${slides.length}`} inert={index !== activeSlide ? '' : undefined}>
          <div className="niche-bay-title">{doubleSided ? (side === 0 ? 'Front side' : 'Back side') : 'Front side'} · Columns {columnLabel(columns[0])}–{columnLabel(columns.at(-1))}</div>
          <div className="niche-bay-scroll">
            <div className="niche-masonry" style={{ '--niche-columns': columnsPerSlide }}>
              {floors.map(floor => <div className="niche-floor" key={floor}>
                <div className="niche-floor-number">Floor<strong>{floor}</strong></div>
                {columns.map(col => {
                  const record = records.get(`${floor}:${col}`);
                  const id = record?.id || `${section}-${cemetery}-F${floor}-C${col}`;
                  const status = record?.status || 'available';
                  const memorial = memorialLabel(record);
                  const muted = filter !== 'all' && filter !== status;
                  const disabled = selectableStatus != null && status !== selectableStatus;
                  return <button type="button" key={id} data-niche-position={`${floor}:${col}`} className={`niche-door ${status} ${muted ? 'niche-muted' : ''} ${disabled ? 'niche-not-selectable' : ''} ${highlight === `${floor}:${col}` ? 'niche-found' : ''}`} disabled={disabled} onClick={() => onSelect(id, floor, col, status, record?.name)} title={`${id}${record?.name ? ` · ${record.name}` : ''}`} aria-label={`Floor ${floor}, column ${columnLabel(col)}, ${status}${record?.name ? `, ${record.name}` : ''}`}>
                    <span className="niche-door-id">F{floor} · C{columnLabel(col)}</span>
                    <span className="niche-door-name">{memorial.name || (status === 'available' ? 'Available niche' : status === 'occupied' ? 'Occupied niche' : status === 'maintenance' ? 'Under maintenance' : 'Unavailable niche')}</span>
                    {status === 'occupied' && <span className="niche-door-date">{memorial.deathDate ? `Died ${memorial.deathDate}` : 'Date of death not recorded'}</span>}
                    <span className="niche-door-status">{status}</span>
                  </button>;
                })}
              </div>)}
            </div>
          </div>
        </section>;
      })}
    </div>
    {slides.length > 1 && <p className="niche-slide-hint">Swipe left or right, or use Previous and Next. All floors stay together.</p>}
    {!slides.length && <p>No niches available for this section.</p>}
  </div>;
}

export default memo(ApartmentNicheWall);
