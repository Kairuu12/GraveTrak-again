import { useState, useEffect } from 'react';
import graveTrakLogo from '../../assets/gravetrak-logo.svg';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if app is already running in standalone mode (installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Detect iOS devices
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    // Listen for the Chrome / Edge / Android install prompt event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Auto-restore visibility if the event fires
      setIsDismissed(false);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      console.log('[GraveTrak PWA] Application was successfully installed.');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  // If already installed or user dismissed it
  if (isInstalled || isDismissed) return null;

  // Only show if prompt is ready OR on iOS where beforeinstallprompt doesn't fire
  if (!deferredPrompt && !isIOS) return null;

  return (
    <>
      <div
        className="pwa-install-banner"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 999990,
          background: 'var(--bg-card, #ffffff)',
          color: 'var(--text-primary, #1e293b)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 16,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          maxWidth: 'min(420px, calc(100vw - 32px))',
          animation: 'pwaSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`
          @keyframes pwaSlideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @media (max-width: 640px) {
            .pwa-install-banner {
              bottom: 16px !important;
              right: 16px !important;
              left: 16px !important;
              max-width: none !important;
            }
          }
        `}</style>

        <img
          src={graveTrakLogo}
          alt="GraveTrak Logo"
          style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, color: 'var(--text-primary, #0f172a)' }}>
            I-install ang GraveTrak
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', marginTop: 2, lineHeight: 1.3 }}>
            I-access ang cemetery map kahit walang signal o internet.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            onClick={handleInstallClick}
            style={{
              background: 'var(--accent, #1687c9)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background 0.2s ease',
            }}
          >
            Install
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            aria-label="Dismiss install prompt"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #94a3b8)',
              fontSize: 16,
              cursor: 'pointer',
              padding: '6px 8px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* iOS Safari Guide Modal */}
      {showIOSGuide && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            style={{
              background: '#ffffff',
              color: '#1e293b',
              borderRadius: 16,
              padding: 24,
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <img src={graveTrakLogo} alt="Logo" style={{ width: 36, height: 36, borderRadius: 8 }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Install on iPhone / iPad</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>GraveTrak Web App</div>
              </div>
            </div>

            <ol style={{ paddingLeft: 20, margin: '14px 0', fontSize: 13, lineHeight: 1.7, color: '#334155' }}>
              <li>
                Pindutin ang <strong>Share button</strong> sa ibaba ng Safari browser (icon ng box na may arrow pataas ⎋).
              </li>
              <li>
                I-scroll pababa at piliin ang <strong>"Add to Home Screen"</strong> (➕).
              </li>
              <li>Pindutin ang <strong>Add</strong> sa kanang itaas.</li>
            </ol>

            <button
              onClick={() => setShowIOSGuide(false)}
              style={{
                width: '100%',
                background: 'var(--accent, #1687c9)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                marginTop: 8,
              }}
            >
              Naiintindihan ko (Close)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
