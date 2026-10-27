import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { addBasemapControl } from '../utils/mapBasemaps.js';
import './mapBasemaps.css';

export const SAFE_CEMETERY_CENTER = [13.93848, 121.62078];

export function isValidLatLng(value) {
  if (!value) return false;
  const lat = Array.isArray(value) ? value[0] : value.lat;
  const lng = Array.isArray(value) ? value[1] : value.lng;
  return Boolean(lat && lng && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng)));
}

export function sanitizeLatLng(value, fallback = SAFE_CEMETERY_CENTER) {
  if (!isValidLatLng(value)) return fallback;
  const lat = Array.isArray(value) ? value[0] : value.lat;
  const lng = Array.isArray(value) ? value[1] : value.lng;
  return [Number(lat), Number(lng)];
}

function cancelLeafletAnimationFrames(mapInstance) {
  if (!mapInstance) return;
  const frameKeys = ['_flyToFrame', '_panAnimFrame', '_resizeRequest'];
  frameKeys.forEach((key) => {
    if (mapInstance[key]) {
      try {
        L.Util.cancelAnimFrame(mapInstance[key]);
      } catch (_) {
        // Ignore private animation cleanup differences between Leaflet versions.
      }
      mapInstance[key] = null;
    }
  });
  if (mapInstance._panAnim) {
    try {
      mapInstance._panAnim.stop();
      mapInstance._panAnim.off();
    } catch (_) {
      // Ignore already-stopped pan animations.
    }
  }
}

function stopLeafletRenderer(renderer) {
  if (!renderer) return;
  try {
    if (renderer._redrawRequest) {
      L.Util.cancelAnimFrame(renderer._redrawRequest);
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(renderer._redrawRequest);
      }
      renderer._redrawRequest = null;
    }
    const noop = () => {};
    // This renderer belongs to a map being permanently disposed. Layer removal
    // must not queue more drawing, and already-bound callbacks must not touch
    // the canvas after Leaflet has destroyed it.
    renderer._requestRedraw = noop;
    renderer._clear = noop;
    renderer._draw = noop;
    renderer.off?.();
  } catch (_) {
    // Ignore renderer cleanup differences between Leaflet versions.
  }
}

function collectLeafletRenderers(mapInstance) {
  const renderers = new Set();
  if (!mapInstance) return renderers;
  if (mapInstance._renderer) renderers.add(mapInstance._renderer);
  try {
    mapInstance.eachLayer((layer) => {
      if (layer?._renderer) renderers.add(layer._renderer);
      if (layer?.options?.renderer) renderers.add(layer.options.renderer);
    });
  } catch (_) {
    // Ignore if the layer registry is already gone.
  }
  return renderers;
}

export function disposeLeafletMap(mapRef, containerRef, extraLayers = []) {
  const mapInstance = mapRef?.current;
  if (!mapInstance) return;

  const renderers = collectLeafletRenderers(mapInstance);
  try {
    cancelLeafletAnimationFrames(mapInstance);
    mapInstance.stop?.();
    // Leaflet's 250ms zoom transition timeout is not cancelled by remove().
    // Its callback returns early when this flag is false.
    mapInstance._animatingZoom = false;
    mapInstance.stopLocate?.();
    mapInstance.off?.();
  } catch (_) {
    // Continue teardown even if Leaflet is already partially disposed.
  }

  renderers.forEach((renderer) => stopLeafletRenderer(renderer));

  extraLayers.forEach((layer) => {
    try {
      layer?.off?.();
      layer?.clearLayers?.();
      if (mapInstance.hasLayer?.(layer)) {
        mapInstance.removeLayer(layer);
      } else {
        layer?.remove?.();
      }
    } catch (_) {
      // Ignore layers that are already detached.
    }
  });

  try {
    mapInstance.eachLayer((layer) => {
      try {
        layer?.off?.();
        layer?.clearLayers?.();
        mapInstance.removeLayer(layer);
      } catch (_) {
        // Silently ignore layers already detached.
      }
    });
  } catch (_) {
    // Ignore if the layer registry is already gone.
  }

  renderers.forEach((renderer) => stopLeafletRenderer(renderer));

  try {
    mapInstance.remove();
  } catch (_) {
    // Leaflet can throw if a route switch already disposed the container.
  }

  mapRef.current = null;
  if (containerRef?.current) {
    delete containerRef.current._leaflet_id;
  }
}

export function makeIcon(status) {
  const colors = { available: '#10b981', occupied: '#ef4444', reserved: '#f59e0b' };
  const color = colors[status] || '#6b7280';
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid rgba(255,255,255,.35);box-shadow:0 0 10px ${color}88;transition:all .2s"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

export function makeColIcon(selected) {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:5px;background:${selected ? '#198765' : '#104735'};border:2px solid ${selected ? '#73C9A7' : '#146B50'};display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 0 10px ${selected ? 'rgba(25,135,101,.5)' : 'rgba(0,0,0,.4)'}">🏛</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
}

export function useLeafletMap({
  containerRef,
  active,
  center,
  zoom = 18,
  markers = [],
  markerIcon,
  onMarkerClick,
  onMapClick,
  zoomControl = false,
  attributionControl = true,
  onMapReady,
  onRenderStateChange,
}) {
  const renderStateRef = useRef(onRenderStateChange);
  useEffect(() => { renderStateRef.current = onRenderStateChange; }, [onRenderStateChange]);
  const mapRef = useRef(null);
  const clickRef = useRef(onMapClick);
  const markerClickRef = useRef(onMarkerClick);
  const markersRef = useRef([]);
  const managedLayersRef = useRef([]);
  const disposedRef = useRef(false);
  const basemapSelectionRef = useRef('map');
  const safeCenter = useMemo(() => sanitizeLatLng(center), [center]);

  useEffect(() => {
    clickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    markerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    renderStateRef.current?.('loading');
    if (!active || !containerRef.current) return;
    disposedRef.current = false;
    if (mapRef.current) {
      const mapInstance = mapRef.current;
      try {
        mapInstance.invalidateSize();
      } catch (_) {
        // Ignore resize work if Leaflet is already tearing down.
      }
      return;
    }

    const map = L.map(containerRef.current, {
      zoomControl,
      attributionControl,
      maxZoom: 24,
      preferCanvas: true,
    }).setView(safeCenter, zoom);

    const originalAddLayer = map.addLayer.bind(map);
    map.addLayer = (layer) => {
      if (layer && !managedLayersRef.current.includes(layer)) {
        managedLayersRef.current.push(layer);
      }
      return originalAddLayer(layer);
    };

    const basemapControl = addBasemapControl(map, {
      initialBasemap: basemapSelectionRef.current,
      onChange: name => { basemapSelectionRef.current = name; },
    });

    map.on('click', (event) => {
      if (!disposedRef.current) clickRef.current?.(event);
    });
    mapRef.current = map;
    let readyAnimationFrame = null;
    let paintedFrame = null;
    let revealFrame = null;
    const reveal = () => {
      paintedFrame = requestAnimationFrame(() => {
        revealFrame = requestAnimationFrame(() => {
          if (!disposedRef.current && mapRef.current === map) renderStateRef.current?.('ready');
        });
      });
    };

    // Remove any stray markers that may exist
    map.eachLayer(layer => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    if (typeof onMapReady === 'function') {
      map.whenReady(() => {
        readyAnimationFrame = requestAnimationFrame(() => {
          const container = containerRef.current;
          if (disposedRef.current || mapRef.current !== map || !container || !container.isConnected) return;
          try {
            const readyLayer = onMapReady(map);
            if (readyLayer && !managedLayersRef.current.includes(readyLayer)) {
              managedLayersRef.current.push(readyLayer);
            }
            reveal();
          } catch (error) {
            // A malformed optional overlay must never take down the full React
            // workspace; keep the base map usable and expose the real error.
            console.error('Unable to render map overlays:', error);
            renderStateRef.current?.('error');
          }
        });
      });
    } else reveal();
    
    // User location tracking (Real-time anywhere)
    let userMarker = null;

    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 14px; height: 14px; background-color: #4285F4; border: 2.5px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 2;"></div>
          <div style="position: absolute; width: 40px; height: 40px; background-color: rgba(66, 133, 244, 0.25); border-radius: 50%; z-index: 1; animation: map-pulse 2s infinite ease-out;"></div>
        </div>
        <style>
          @keyframes map-pulse {
            0% { transform: scale(0.5); opacity: 1; }
            100% { transform: scale(1.5); opacity: 0; }
          }
        </style>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    map.on('locationfound', (e) => {
      if (disposedRef.current) return;
      const userLatLng = sanitizeLatLng(e.latlng, null);
      if (!userLatLng) return;
      if (!userMarker) {
        userMarker = L.marker(userLatLng, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
      } else {
        userMarker.setLatLng(userLatLng);
      }
    });

    // Start watching user location continuously
    map.locate({ watch: true, enableHighAccuracy: true });

    // Custom Control for 'Center on me'
    const LocateControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control leaflet-control-custom');
        btn.style.backgroundColor = 'white';
        btn.style.width = '34px';
        btn.style.height = '34px';
        btn.style.cursor = 'pointer';
        btn.style.border = '2px solid rgba(0,0,0,0.2)';
        btn.style.backgroundClip = 'padding-box';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.marginBottom = '20px';
        btn.style.marginRight = '10px';
        // Icon resembling crosshairs/location
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="#333" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`;
        btn.title = "Show my real-time location";
        btn.onclick = function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (disposedRef.current) return;
          if (userMarker) {
            map.flyTo(sanitizeLatLng(userMarker.getLatLng()), 19, { animate: true, duration: 0.8 });
          } else {
            map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true });
          }
        };
        return btn;
      }
    });
    map.addControl(new LocateControl());

    return () => {
      disposedRef.current = true;
      cancelAnimationFrame(paintedFrame);
      cancelAnimationFrame(revealFrame);
      basemapControl.remove();
      const mapInstance = mapRef.current;
      if (readyAnimationFrame) {
        cancelAnimationFrame(readyAnimationFrame);
        readyAnimationFrame = null;
      }

      if (mapInstance) {
        disposeLeafletMap(mapRef, containerRef, [
          ...markersRef.current,
          ...managedLayersRef.current,
        ]);
      }
      markersRef.current = [];
      managedLayersRef.current = [];
    };
  }, [active, safeCenter, zoom, containerRef, zoomControl, attributionControl, onMapReady]);

  // center/zoom already initialize the map in the lifecycle effect above.
  // A second flyTo here raced with onMapReady's fitBounds and made returning
  // to a map look like several consecutive reloads.


  return mapRef;
}
