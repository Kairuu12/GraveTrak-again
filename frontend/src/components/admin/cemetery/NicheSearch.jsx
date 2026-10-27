import { useId, useMemo, useState } from 'react';

export default function NicheSearch({ slots, onChoose, compact = false }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? slots.filter(slot => {
      const text = `${slot.name || ''} ${slot.id} ${slot.section} ${slot.cemeteryMap}`.toLowerCase();
      return words.every(word => text.includes(word));
    }) : [];
  }, [query, slots]);
  return <div className={`niche-search ${compact ? 'niche-search-compact' : ''}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    {!compact && <label htmlFor={inputId}>Find a person or niche</label>}
    <input id={inputId} aria-label="Search niche records by name, ID, or section" type="search" className="admin-select" placeholder={compact ? 'Search name, niche ID, or section…' : 'Search name or niche ID across both cemeteries'} value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} />
    {open && query.trim() && <div className="niche-search-results">
      <p role="status">{results.length ? `${results.length} matches${results.length > 30 ? ' — showing first 30; refine your search' : ''}` : 'No matching records.'}</p>
      {results.slice(0, 30).map(slot => <button type="button" key={`${slot.cemeteryMap}:${slot.id}`} onClick={() => { onChoose(slot); setQuery(''); setOpen(false); }}>
        <strong>{slot.name || slot.id}</strong><span>{slot.cemeteryMap === 'new' ? 'New' : 'Old'} Cemetery · {slot.section} · Floor {slot.floor} · {slot.id}</span>
      </button>)}
    </div>}
  </div>;
}
