import { useCallback, useEffect, useState } from 'react';

export default function useCemeteryTransition(mapRef, active) {
  const [transition, setTransition] = useState(null);
  const switchCemetery = useCallback((name, center) => {
    if (!mapRef.current) return;
    setTransition({ name, center, started: Date.now(), failed: false });
  }, [mapRef]);

  useEffect(() => {
    if (!active || !transition || transition.failed) return;
    const map = mapRef.current;
    if (!map) { setTransition(null); return; }
    let cancelled = false, frame, timer;
    const started = Date.now();
    const check = () => {
      if (cancelled) return;
      let loading = false;
      map.eachLayer(layer => { if (typeof layer.isLoading === 'function' && layer.isLoading()) loading = true; });
      if (!loading && Date.now() - started >= 500) {
        setTransition(null);
      } else if (Date.now() - started >= 10000) {
        setTransition(current => current ? { ...current, failed: true } : null);
      } else timer = setTimeout(check, 150);
    };
    // Paint the cover before moving, so unloaded tiles between cemeteries
    // never appear during Leaflet's zoom-out / fly-across animation.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        map.stop();
        map.setView(transition.center, 19, { animate: false });
        check();
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [transition, active, mapRef]);

  useEffect(() => { if (!active) setTransition(null); }, [active]);
  return { transition, switchCemetery, dismissTransition: () => setTransition(null) };
}
