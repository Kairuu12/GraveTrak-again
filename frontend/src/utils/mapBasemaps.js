import L from 'leaflet';

const TILE_OPTIONS = {
  maxNativeZoom: 19,
  maxZoom: 24,
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1,
};

// The public, online World Imagery tile service. Keep these requests out of
// offline tile exports; ordinary browser HTTP caching is sufficient.
const SATELLITE_TILE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false';

export function addBasemapControl(map, { initialBasemap = 'map', onChange } = {}) {
  const layers = {};
  const buttons = {};
  let activeBasemap = null;
  let disposed = false;
  let loadedTiles = 0;
  let failedTiles = 0;
  let fallbackTimer = null;
  let status;

  const getLayer = (name) => {
    if (layers[name]) return layers[name];
    if (name === 'satellite') {
      const layer = L.tileLayer(SATELLITE_TILE_URL, {
        ...TILE_OPTIONS,
        // Both cemetery locations have real imagery through zoom 18. Beyond
        // that, scale existing tiles while grave overlays remain fully zoomable.
        maxNativeZoom: 18,
        className: 'gravetrak-satellite-tiles',
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      });
      layer.on('loading', () => { loadedTiles = 0; failedTiles = 0; });
      layer.on('tileload', () => { loadedTiles += 1; });
      layer.on('tileerror', () => { failedTiles += 1; });
      layer.on('load', () => {
        if (!disposed && activeBasemap === 'satellite' && failedTiles > 0 && loadedTiles === 0) {
          // Leaflet still finishes its tile bookkeeping after firing load.
          // Switch on the next task so removing the layer cannot interrupt it.
          clearTimeout(fallbackTimer);
          fallbackTimer = setTimeout(() => {
            fallbackTimer = null;
            if (!disposed && activeBasemap === 'satellite' && failedTiles > 0 && loadedTiles === 0) {
              selectBasemap('map', 'Satellite unavailable. Showing Map.');
            }
          }, 0);
        }
      });
      layers[name] = layer;
    } else {
      layers[name] = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        ...TILE_OPTIONS,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
    }
    return layers[name];
  };

  function selectBasemap(name, message = '') {
    if (disposed || (name !== 'map' && name !== 'satellite')) return;
    if (status) {
      status.textContent = message;
      status.hidden = !message;
    }
    if (activeBasemap === name) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
    const nextLayer = getLayer(name);
    if (activeBasemap) map.removeLayer(layers[activeBasemap]);
    activeBasemap = name;
    nextLayer.addTo(map);
    Object.entries(buttons).forEach(([key, button]) => {
      button.setAttribute('aria-pressed', String(key === name));
    });
    onChange?.(name);
    map.fire('baselayerchange', { name: name === 'satellite' ? 'Satellite' : 'Map', layer: nextLayer });
  }

  const BasemapControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-basemap-control');
      const choices = L.DomUtil.create('div', 'leaflet-basemap-choices', container);
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', 'Map background');
      ['map', 'satellite'].forEach(name => {
        const button = L.DomUtil.create('button', 'leaflet-basemap-button', choices);
        button.type = 'button';
        button.textContent = name === 'satellite' ? 'Satellite' : 'Map';
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => selectBasemap(name));
        buttons[name] = button;
      });
      status = L.DomUtil.create('div', 'leaflet-basemap-status', container);
      status.setAttribute('role', 'status');
      status.hidden = true;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      return container;
    },
  });
  const control = new BasemapControl().addTo(map);
  // Center the switch in the map itself, clear of office side panels. Leaflet
  // still owns the control and removes it normally during map disposal.
  map.getContainer().appendChild(control.getContainer());
  selectBasemap(initialBasemap === 'satellite' ? 'satellite' : 'map');

  const remove = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(fallbackTimer);
    map.off('unload', remove);
    control.remove();
    Object.values(layers).forEach(layer => {
      layer.off();
      if (map.hasLayer(layer)) map.removeLayer(layer);
    });
  };
  map.on('unload', remove);
  return { remove };
}
