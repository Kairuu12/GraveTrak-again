// Camera-only controller: never changes the route, distance or destination.
export function createRouteCamera(map, {
  onChange = () => {}, getPadding = () => ({ paddingTopLeft: [24, 160], paddingBottomRight: [24, 170] }),
  reducedMotion = false, schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let route = [], location = null, following = false, disposed = false, timer = null, ready = false, started = false;
  const emit = mode => { if (!disposed) onChange({ mode, ready, hasLocation: !!location, started }); };
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const focus = coords => {
    if (disposed || !coords) return;
    const zoom = Math.min(20, map.getMaxZoom());
    const padding = getPadding();
    const top = padding.paddingTopLeft || [24, 24], bottom = padding.paddingBottomRight || [24, 24];
    const center = map.unproject(map.project(coords, zoom).subtract([(top[0] - bottom[0]) / 2, (top[1] - bottom[1]) / 2]), zoom);
    map.stop();
    map.flyTo(center, zoom, { animate: !reducedMotion, duration: 0.85 });
  };
  const pause = () => {
    if (disposed) return;
    clear(); following = false; emit('paused');
  };
  const wheel = () => pause();
  const touch = event => { if (event.touches?.length > 1) pause(); };
  const key = event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '='].includes(event.key)) pause(); };
  const container = map.getContainer();
  map.on('dragstart', pause);
  container.addEventListener('wheel', wheel, { passive: true });
  container.addEventListener('keydown', key);
  container.addEventListener('touchstart', touch, { passive: true });
  return {
    setRoute(points) {
      if (disposed || points.length < 2) return;
      route = points;
      if (ready) return; // GPS reroutes must not restart the overview animation.
      ready = true;
      this.overview();
      timer = schedule(() => {
        timer = null;
        if (disposed) return;
        focus(location || route[0]); emit('ready');
      }, reducedMotion ? 1600 : 2400);
    },
    updateLocation(coords) {
      if (disposed) return;
      const previous = location;
      location = coords;
      // Ignore tiny GPS jitter instead of restarting a fly animation each fix.
      const moved = !previous || Math.hypot(coords[0] - previous[0], coords[1] - previous[1]) * 111000 >= 3;
      if (following && moved) focus(location);
      emit(following ? 'following' : 'location-updated');
    },
    loseLocation() { location = null; pause(); },
    start() {
      if (disposed || !ready || !location) return false;
      clear(); following = true; started = true; focus(location); emit('following'); return true;
    },
    overview() {
      if (disposed || !ready) return;
      clear(); following = false;
      map.stop(); map.fitBounds(route, { ...getPadding(), maxZoom: 19, animate: !reducedMotion, duration: 0.8 });
      emit('overview');
    },
    startPoint() { if (!disposed && ready) { clear(); following = false; focus(route[0]); emit('ready'); } },
    dispose() {
      clear(); disposed = true; following = false;
      map.stop();
      map.off('dragstart', pause);
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('keydown', key);
      container.removeEventListener('touchstart', touch);
    },
  };
}
