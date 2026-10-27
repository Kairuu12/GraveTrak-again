import { useState, useEffect } from 'react';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setShowRestored(true);
      const timer = setTimeout(() => setShowRestored(false), 3500);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOffline(true);
      setShowRestored(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Do not cover the app navigation/search controls while offline. The app
  // already continues using its cached data; only show the short confirmation
  // when the connection comes back.
  if (isOffline || !showRestored) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 18px',
        borderRadius: 24,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
        animation: 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        background: isOffline ? 'rgba(217, 83, 79, 0.95)' : 'rgba(25, 135, 101, 0.95)',
        color: '#ffffff',
        border: '1px solid rgba(255,255,255,0.2)',
        pointerEvents: 'none',
        maxWidth: '92vw',
        textAlign: 'center',
      }}
    >
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -15px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
      <span style={{ fontSize: 16 }}>{isOffline ? '📶' : '✅'}</span>
      <span>
        {isOffline
          ? 'Offline Mode — Gumagana ang mapa gamit ang naka-cache na datos ng sementeryo.'
          : 'Online na muli — Na-restore ang inyong koneksyon.'}
      </span>
    </div>
  );
}
