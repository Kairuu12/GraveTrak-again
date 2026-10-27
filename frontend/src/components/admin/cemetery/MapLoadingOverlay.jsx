import './MapLoadingOverlay.css';

export default function MapLoadingOverlay({ cemetery, error, onRetry }) {
  return <div className="cemetery-map-loading" role={error ? 'alert' : 'status'} aria-live="polite">
    <div className="cemetery-map-loading-card">
      <div className={`cemetery-map-loader ${error ? 'has-error' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z M9 3v16 M15 5v16" /></svg>
      </div>
      <span className="cemetery-map-loading-label">{cemetery === 'new' ? 'New' : 'Old'} Cemetery</span>
      <h2>{error ? 'Unable to prepare the map' : 'Preparing cemetery map…'}</h2>
      <p>{error || 'Loading sections, pathways, and plot layouts. Please wait a moment.'}</p>
      {error && onRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>Retry map</button>}
    </div>
  </div>;
}
