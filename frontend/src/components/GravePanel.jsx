import { useState, useEffect } from 'react';

export default function GravePanel({ grave, onClose, mapRef, onApply, graveData = [], columbariumSlots = [], onNavigateRoute, isNavigating = false, closeOnNavigate = false, onSaveGrave, isGraveSaved = () => false, saveBusy = false, onSelectFloor, onBackToFloors }) {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!grave) return null;

  // Standard cemetery stacks have four floors; ground plots use their saved layout.
  const defaultFloors = grave.isPlotStack && !grave.isGroundPlotStack ? 4 : 1;
  const floorCount = Math.max(1, Number(grave.floors || grave.estimated_stack_height || defaultFloors));
  const floorLabels = Array.from({ length: floorCount }, (_, index) => floorCount - index);
  const normalizeSectionName = (section) => {
    if (!section) return '';
    const text = String(section).trim();
    if (/^[A-Za-z]$/.test(text)) return `Section ${text.toUpperCase()}`;
    const upper = text.replace(/^(sec(?:tion)?\s*)/i, 'Section ');
    const match = upper.match(/^Section\s*([A-Za-z])$/i);
    if (match) return `Section ${match[1].toUpperCase()}`;
    return upper;
  };

  const stackId = grave.id || grave.grave_id; // The ID of the stack, e.g., "Section A-new-C1"
  const cemeteryMapContext = grave.cemeteryMap || grave.cemetery_map || 'old';
  const sectionName = normalizeSectionName(grave.section || (grave.id ? grave.id.split('-C')[0] : ''));
  const columnNumber = grave.column || (grave.id ? parseInt(String(grave.id).split('-C').pop(), 10) : undefined);

  // If the selected item matches a columbarium slot id, prefer that data
  // For a stack, we don't have a single matchedColumbarium, but rather 4 slots.
  // The grave object itself should contain the stack info.
  const displayStatus = grave.status || 'available'; // This will be 'available' for the stack
  const nameWithDates = String(grave.name || '').match(/^(.*?)\s+\(([^()]*\d[^()]*)\)$/);
  const displayName = nameWithDates ? nameWithDates[1] : grave.name;
  const displayDates = grave.dates || nameWithDates?.[2];
  const displayLocation = grave.location || [grave.section, grave.floor && `Floor ${grave.floor}`, (grave.col || grave.column) && `Column ${grave.col || grave.column}`].filter(Boolean).join(', ');

  const statusBadge = {
    available: 'badge-green',
    occupied: 'badge-red',
    reserved: 'badge-red',
  };

  const mobileCenterStyles = {};
  const handleDirections = () => {
    if (onNavigateRoute) onNavigateRoute(grave);
    if (closeOnNavigate) onClose?.();
  };

  if (grave.isPlotStack) {
    return (
      <div className={`grave-panel ${grave ? 'show' : ''}`} style={{ width: isMobile ? '90%' : '320px', maxWidth: '350px', zIndex: 99999, ...mobileCenterStyles }}>
        <div className="gp-header">
          <div>
            <div className="gp-id">{stackId}</div>
          <div className="gp-name">Multi-level Plot ({floorCount} Floor{floorCount === 1 ? '' : 's'})</div>
          </div>
          <button className="gp-close" aria-label="Close location details" onClick={onClose}>✕</button>
        </div>
        <div className="gp-body" style={{ padding: '16px', overflowY: 'auto', maxHeight: '60vh' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Select a floor level to view:</div>
          <div className="gp-floor-grid" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {floorLabels.map(floor => {
              // Construct the standard slot ID for each floor
              const slotId = grave.isGroundPlotStack
                ? `${stackId}-F${floor}`
                : `${sectionName}-F${floor}-C${columnNumber}`;
              
              const floorRecord = (!grave.isGroundPlotStack && columbariumSlots.find(s => 
                normalizeSectionName(s.section) === sectionName &&
                Number(s.floor) === floor &&
                Number(s.col) === columnNumber &&
                (s.cemeteryMap || s.cemetery_map) === cemeteryMapContext
              )) || {
                id: slotId,
                grave_id: slotId,
                status: 'available',
                name: '— Available —',
                dates: '—',
                location: `${grave.location} - Floor ${floor}`,
                latlng: grave.latlng,
                cemeteryMap: grave.cemeteryMap
              };
              
              const saveTarget = { ...floorRecord, cemeteryMap: cemeteryMapContext, floor, section: sectionName, col: columnNumber, latlng: floorRecord.latlng || grave.latlng, location: `${sectionName}, Floor ${floor}, Column ${columnNumber}`, isPlotStack: false };
              const clickable = Boolean(onSelectFloor && floorRecord.status === 'occupied' && floorRecord.name);
              return (
                <div key={floor} style={{ 
                  padding: '12px', 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div className={clickable ? 'gp-floor-select' : undefined} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
                    aria-label={clickable ? `View deceased details on Floor ${floor}` : undefined}
                    onClick={clickable ? () => onSelectFloor(saveTarget) : undefined}
                    onKeyDown={clickable ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectFloor(saveTarget); } } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '14px' }}>Floor {floor}</div>
                    <span className={`badge ${statusBadge[floorRecord.status] || 'badge-green'}`} style={{ fontSize: '10px' }}>
                      {floorRecord.status === 'reserved' ? 'UNAVAILABLE' : floorRecord.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {floorRecord.status === 'occupied'
                      ? `Occupant: ${floorRecord.name}`
                      : floorRecord.status === 'reserved'
                        ? 'Slot unavailable'
                        : 'Empty slot ready for assignment'}
                  </div>
                  {clickable && <span className="gp-floor-link">View deceased details →</span>}
                  </div>
                  {onSaveGrave && floorRecord.status === 'occupied' && <button className="btn btn-ghost btn-sm" disabled={saveBusy || isGraveSaved(saveTarget)} onClick={() => onSaveGrave(saveTarget)}>{isGraveSaved(saveTarget) ? 'Saved' : 'Save to My Loved Ones'}</button>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="gp-footer">
          <div className="gp-actions gp-actions-stack">
            <button className="btn btn-primary btn-sm gp-directions" onClick={handleDirections}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.71 11.29l-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 0 0 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>
              Directions
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`grave-panel ${grave ? 'show' : ''}`} style={isMobile ? { width: '90%', maxWidth: '350px', zIndex: 99999, ...mobileCenterStyles } : {}}>
      <div className="gp-header">
        <div>
          <div className="gp-id">{grave.floor ? 'Niche' : 'Grave'} details{(grave.grave_id || grave.id) ? ` · ${grave.grave_id || grave.id}` : ''}</div>
          <div className="gp-name">{displayName}</div>
        </div>
        <button className="gp-close" aria-label="Close location details" onClick={onClose}>✕</button>
      </div>
      <div className="gp-body">
        {onBackToFloors && <button className="btn btn-ghost btn-sm gp-back-floors" onClick={onBackToFloors}>← Back to floors</button>}
        <div className="gp-row">
          <span className="gp-label">Status</span>
          <span className="gp-val"><span className={`badge ${statusBadge[displayStatus]}`}>{displayStatus === 'reserved' ? 'UNAVAILABLE' : displayStatus.toUpperCase()}</span></span>
        </div>
        {displayDates && <div className="gp-row">
          <span className="gp-label">Dates</span>
          <span className="gp-val">{displayDates}</span>
        </div>}
        <div className="gp-row">
          <span className="gp-label">Location</span>
          <span className="gp-val">{displayLocation || 'Location details unavailable'}</span>
        </div>
        <div className="gp-row">
          <span className="gp-label">Cemetery</span>
          <span className="gp-val">{cemeteryMapContext === 'new' ? 'New Cemetery' : 'Old Cemetery'}</span>
        </div>
      </div>
      <div className="gp-footer">
        <div className="gp-actions">
          <button className="btn btn-primary btn-sm gp-directions" onClick={handleDirections}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21.71 11.29l-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 0 0 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9a.996.996 0 0 0 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>
            Directions
          </button>
          {onSaveGrave && <button className="btn btn-ghost btn-sm gp-save" disabled={saveBusy || isGraveSaved(grave)} onClick={() => onSaveGrave(grave)}>{isGraveSaved(grave) ? 'Saved to My Loved Ones' : 'Save to My Loved Ones'}</button>}
          <button className="btn btn-ghost btn-sm gp-close-action" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
