import { useId, useMemo, useState } from 'react';
import { staffSearchResults } from '../../../utils/staffSearch.js';

export default function StaffSearch({ slots, plots, sections, onChoose, onClear, loading, error }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const results = useMemo(() => staffSearchResults(query, slots, plots, sections), [query, slots, plots, sections]);
  const expanded = open && Boolean(query.trim());
  const choose = row => { onChoose(row); setQuery(''); setOpen(false); setCursor(-1); };
  return <div className="niche-search niche-search-compact" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <input id={id} type="search" className="admin-select" placeholder="Search name, plot, niche, or section…"
      aria-label="Search people, plots, niches, and sections across both cemeteries" role="combobox" autoComplete="off"
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`}
      aria-activedescendant={expanded && results[cursor] ? `${id}-${cursor}` : undefined}
      value={query} onFocus={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setCursor(-1); setOpen(true); onClear(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); setCursor(-1); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setCursor(value => results.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : -1);
        }
        if (event.key === 'Enter' && expanded && results.length) { event.preventDefault(); choose(results[Math.max(0, cursor)]); }
      }} />
    {expanded && <div className="niche-search-results">
      <p role="status">{loading ? 'Loading map records…' : error ? 'Some records could not load. Reopen the map to retry.' : results.length ? 'Matching locations · Refine your search for more results' : 'No matching records.'}</p>
      <div id={`${id}-results`} role="listbox" aria-label="Matching locations">
        {results.map((row, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${index}`} aria-selected={cursor === index}
          style={cursor === index ? { background: 'var(--bg-surface)' } : undefined}
          key={`${row.kind}:${row.cemeteryMap}:${row.id}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(row)}>
          <strong>{row.name || row.id}</strong><span>{row.detail} · {row.cemeteryMap === 'new' ? 'New' : 'Old'} Cemetery · {row.section}</span>
        </button>)}
      </div>
    </div>}
  </div>;
}
