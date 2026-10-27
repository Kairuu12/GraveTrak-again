import { useMemo, useState } from 'react';
import './MyLovedOnes.css';

const cemeteryName = value => value === 'new' ? 'New Cemetery' : 'Old Cemetery';
const savedDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function MemorialMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true" className="loved-ones-mark">
    <path d="M24 41S7 31.2 7 18.8C7 11.5 16.2 7.6 24 16c7.8-8.4 17-4.5 17 2.8C41 31.2 24 41 24 41Z" />
    <path d="M24 15v16m-6-9h12" />
  </svg>;
}

export default function MyLovedOnes({ saved, onView, onRemove }) {
  const [query, setQuery] = useState('');
  const [cemeteryFilter, setCemeteryFilter] = useState('all');
  const [removingId, setRemovingId] = useState(null);
  const counts = useMemo(() => ({
    old: saved.items.filter(item => item.cemetery !== 'new').length,
    new: saved.items.filter(item => item.cemetery === 'new').length,
  }), [saved.items]);
  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return saved.items.filter(item => {
      const details = item.details || {};
      const matchesCemetery = cemeteryFilter === 'all' || item.cemetery === cemeteryFilter;
      const searchable = [details.name, item.grave_id, details.location, details.section, cemeteryName(item.cemetery), details.floor && `floor ${details.floor}`].filter(Boolean).join(' ').toLocaleLowerCase();
      return matchesCemetery && (!term || searchable.includes(term));
    });
  }, [saved.items, query, cemeteryFilter]);

  if (saved.loading) return <div className="loved-ones-loading" role="status"><span className="loved-ones-spinner" />Loading your saved graves…</div>;
  if (saved.error) return <section className="loved-ones-state loved-ones-error" role="alert"><div className="loved-ones-state-mark">!</div><h2>We couldn’t load your list</h2><p>{saved.error}</p><button className="btn btn-primary" onClick={saved.retry}>Try again</button></section>;

  return <section className="loved-ones-page" aria-label="My Loved Ones">
    <div className="loved-ones-hero">
      <div className="loved-ones-hero-mark"><MemorialMark /></div>
      <div className="loved-ones-hero-copy"><span className="loved-ones-eyebrow">Your private remembrance list</span><h2>Keep their places close.</h2><p>Save a resting place, find it on the cemetery map, and keep the details together.</p></div>
      <button className="btn btn-primary loved-ones-find" onClick={() => onView(null)}><span aria-hidden="true">⌕</span> Find a grave</button>
    </div>

    <div className="loved-ones-summary" aria-label="Saved grave counts">
      <div className="loved-ones-total"><strong>{saved.items.length}</strong><span>{saved.items.length === 1 ? 'saved place' : 'saved places'}</span></div>
      <div className="loved-ones-summary-divider" />
      <div><strong>{counts.old}</strong><span>Old Cemetery</span></div>
      <div><strong>{counts.new}</strong><span>New Cemetery</span></div>
    </div>

    {saved.items.length > 0 && <div className="loved-ones-tools">
      <label className="loved-ones-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name, grave ID, section…" aria-label="Search saved graves" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
      <div className="loved-ones-filters" role="group" aria-label="Filter by cemetery">
        {[['all', 'All places'], ['old', 'Old Cemetery'], ['new', 'New Cemetery']].map(([value, label]) => <button key={value} type="button" className={cemeteryFilter === value ? 'active' : ''} aria-pressed={cemeteryFilter === value} onClick={() => setCemeteryFilter(value)}>{label}</button>)}
      </div>
    </div>}

    {!saved.items.length ? <div className="loved-ones-state loved-ones-empty"><div className="loved-ones-state-mark"><MemorialMark /></div><span className="loved-ones-eyebrow">A place to remember</span><h2>Your list starts here</h2><p>When you find a grave on the map, save it to keep its location and details close at hand.</p><button className="btn btn-primary" onClick={() => onView(null)}>Explore the cemetery map</button></div> : visibleItems.length === 0 ? <div className="loved-ones-no-results"><strong>No saved places match</strong><span>Try another name, grave ID, or cemetery filter.</span><button className="btn btn-ghost" onClick={() => { setQuery(''); setCemeteryFilter('all'); }}>Clear filters</button></div> :
      <div className="loved-ones-grid">
        {visibleItems.map(item => {
          const details = item.details || {};
          const locationParts = [details.section, details.floor ? `Floor ${details.floor}` : ''].filter(Boolean);
          return <article className="loved-ones-card" key={item.id}>
            <div className="loved-ones-card-top"><span className="loved-ones-card-mark"><MemorialMark /></span><span className="loved-ones-cemetery">{cemeteryName(item.cemetery)}</span></div>
            <h3>{details.name || 'Saved grave'}</h3>
            <div className="loved-ones-grave-id">GRAVE ID <strong>{item.grave_id}</strong></div>
            <div className="loved-ones-details">
              {details.location && <div><span className="loved-ones-detail-icon" aria-hidden="true">⌖</span><span>{details.location}</span></div>}
              {locationParts.length > 0 && <div><span className="loved-ones-detail-icon" aria-hidden="true">▦</span><span>{locationParts.join(' · ')}</span></div>}
              {details.dates && <div><span className="loved-ones-detail-icon" aria-hidden="true">♡</span><span>{details.dates}</span></div>}
            </div>
            <div className="loved-ones-card-footer">
              <span>{savedDate(item.created_at) ? `Saved ${savedDate(item.created_at)}` : 'Saved to your account'}</span>
              <div><button className="btn btn-primary" onClick={() => onView({ ...details, id: item.grave_id, grave_id: item.grave_id, cemeteryMap: item.cemetery, status: 'unknown' })}>View on map</button>
                <button className="loved-ones-remove" disabled={saved.busy || removingId === item.id} onClick={async () => { setRemovingId(item.id); try { await onRemove(item.id); } finally { setRemovingId(null); } }} aria-label={`Remove ${details.name || 'saved grave'} from My Loved Ones`}>{removingId === item.id ? 'Removing…' : 'Remove'}</button></div>
            </div>
          </article>;
        })}
      </div>}
    <p className="loved-ones-privacy"><span aria-hidden="true">●</span> Only you can see the graves saved to your account.</p>
  </section>;
}
