// Isolated browser checks for the real shared map hook; no project database.
// Run after npm run build: node scripts/test_map_basemaps.cjs
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp/map-basemap-review');
const esbuild = require(path.join(root, 'frontend/node_modules/esbuild'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], results = [];
let server, chrome, socket;

const fixture = `
import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import { useLeafletMap } from './src/hooks/useLeafletMap.jsx';
import 'leaflet/dist/leaflet.css';
import './styles.css';
Object.defineProperty(navigator, 'geolocation', { value: { watchPosition: () => 1, clearWatch: () => {} }, configurable: true });
window.tileRequests = [];
window.failSatellite = false;
const realCreateTile = L.TileLayer.prototype.createTile;
L.TileLayer.prototype.createTile = function(coords, done) {
  const satellite = this.options.className === 'gravetrak-satellite-tiles';
  window.tileRequests.push({ satellite, zoom: coords.z, url: this.getTileUrl(coords) });
  const tile = document.createElement('img');
  tile.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="' + (satellite ? '#466453' : '#c8d5dd') + '"/></svg>');
  const key = this._tileCoordsToKey(coords);
  setTimeout(() => {
    // Match Leaflet's real image cancellation when a tile/map is removed.
    if (this._map && this._tiles[key]?.el === tile) done(satellite && window.failSatellite ? new Error('Intentional imagery failure') : null, tile);
  }, 20);
  return tile;
};
const app = createRoot(document.getElementById('root'));
function Fixture({ kind }) {
  const containerRef = useRef(null);
  const [cemetery, setCemetery] = useState('old');
  window.changeCemetery = setCemetery;
  const center = cemetery === 'old' ? [13.93848, 121.62078] : [13.93124, 121.62076];
  const onMapReady = useCallback(map => {
    window.fixtureMap = map;
    window.overlayClicks = 0;
    const renderer = L.canvas();
    const overlay = L.polygon([[center[0], center[1]], [center[0]+.00003, center[1]], [center[0]+.00003, center[1]+.00005], [center[0], center[1]+.00005]], { renderer, color: '#1687C9', fillColor: '#1687C9' }).addTo(map);
    overlay.bindPopup('Existing plot popup').on('click', () => window.overlayClicks++);
    window.fixtureOverlay = overlay;
    return overlay;
  }, [cemetery]);
  useLeafletMap({ containerRef, active: true, center, zoom: 19, onMapReady });
  return React.createElement('section', { id: kind === 'public' ? 'screen-public' : kind === 'cpdo' ? 'panel-planning' : 'panel-admin-map', className: 'screen active' },
    React.createElement('div', { ref: containerRef, style: { width: '100vw', height: '100vh' } }));
}
window.mountMap = kind => { window.fixtureMap = null; window.fixtureOverlay = null; app.render(React.createElement(React.StrictMode, null, React.createElement(Fixture, { key: kind, kind }))); };
window.inspectMap = () => {
  const map = window.fixtureMap, tiles = [];
  map.eachLayer(layer => { if (layer instanceof L.TileLayer) tiles.push(layer); });
  const layer = tiles[0], control = map.getContainer().querySelector('.leaflet-basemap-control');
  const rect = control?.getBoundingClientRect();
  return { tileLayers: tiles.length, tileIds: tiles.map(L.Util.stamp), satellite: layer?.options.className === 'gravetrak-satellite-tiles', nativeZoom: layer?.options.maxNativeZoom, buffer: layer?.options.keepBuffer,
    idle: layer?.options.updateWhenIdle, duringZoom: layer?.options.updateWhenZooming,
    overlayId: L.Util.stamp(window.fixtureOverlay), overlayPresent: map.hasLayer(window.fixtureOverlay), overlayColor: window.fixtureOverlay.options.fillColor,
    controls: map.getContainer().querySelectorAll('.leaflet-basemap-control').length,
    attribution: map.getContainer().querySelector('.leaflet-control-attribution')?.textContent,
    attributionVisible: getComputedStyle(map.getContainer().querySelector('.leaflet-control-attribution')).display !== 'none',
    imageryFilter: layer?.getContainer()?.querySelector('img') ? getComputedStyle(layer.getContainer().querySelector('img')).filter : null,
    rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    errorMessage: control?.querySelector('[role=status]')?.textContent };
};
window.useLiveTiles = () => { L.TileLayer.prototype.createTile = realCreateTile; window.fixtureMap.eachLayer(layer => { if (layer instanceof L.TileLayer) layer.redraw(); }); };
window.mountMap('cpdo');
`;

(async () => {
  try {
    fs.mkdirSync(output, { recursive: true });
    await esbuild.build({ stdin: { contents: fixture, resolveDir: path.join(root, 'frontend'), sourcefile: 'map-fixture.jsx', loader: 'jsx' }, outfile: path.join(output, 'fixture.js'), bundle: true, format: 'esm', loader: { '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.html': 'text/html' };
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/fixture') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>.leaflet-control-attribution{display:none!important}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
        return;
      }
      const base = pathname.startsWith('/fixture.') ? output : path.join(root, 'frontend/dist');
      let file = path.resolve(base, '.' + pathname);
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'frontend/dist/index.html');
      res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(5188, '127.0.0.1', resolve));
    const browserProfile = fs.mkdtempSync(path.join(output, 'chrome-'));
    chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + browserProfile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let tabs;
    for (let i = 0; i < 100; i++) { try { const port = fs.readFileSync(path.join(browserProfile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]; tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); break; } catch { await delay(100); } }
    assert.ok(tabs, 'Headless Chrome did not start');
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    const pending = new Map(); let nextId = 0;
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id) { const task = pending.get(data.id); pending.delete(data.id); data.error ? task.reject(data.error) : task.resolve(data.result); }
      else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
      else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(arg => arg.value || arg.description).join(' '));
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => {
      const data = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (data.exceptionDetails) throw Error(data.exceptionDetails.exception?.description || data.exceptionDetails.text);
      return data.result.value;
    };
    const waitFor = async expression => { for (let i = 0; i < 100; i++) {
      try { if (await evaluate(expression)) return; }
      catch (error) { if (!/context|navigated/i.test(error.message || '')) throw error; }
      await delay(100);
    } throw Error('Timed out: ' + expression + '\n' + JSON.stringify(errors) + '\n' + await evaluate('JSON.stringify({url:location.href,screen:document.querySelector("#screen-app")?.className,requests:window.reviewRequests,nav:[...document.querySelectorAll(".nav-item")].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height}))})') + '\n' + await evaluate('document.body?.innerText?.slice(0,1000)')); };
    const click = async name => {
      const button = await evaluate(`(() => { const node = [...document.querySelectorAll('.leaflet-basemap-button')].find(node => node.textContent === ${JSON.stringify(name)}); const r = node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button, button: 'left', clickCount: 1 });
      await delay(70);
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:5188/fixture' });
    await waitFor('Boolean(window.fixtureMap && window.fixtureOverlay)');
    await delay(150);
    assert.equal(await evaluate('tileRequests.filter(tile => tile.satellite).length'), 0, 'Satellite must stay unloaded initially');
    for (const kind of ['cpdo', 'staff', 'public']) {
      if (kind !== 'cpdo') await evaluate(`mountMap(${JSON.stringify(kind)})`);
      await waitFor('Boolean(window.fixtureMap && window.fixtureOverlay)');
      await waitFor(`document.querySelector(${JSON.stringify(kind === 'cpdo' ? '#panel-planning .leaflet-basemap-control' : kind === 'staff' ? '#panel-admin-map .leaflet-basemap-control' : '#screen-public .leaflet-basemap-control')}) !== null`);
      const before = await evaluate('inspectMap()');
      assert.equal(before.tileLayers, 1);
      assert.equal(before.satellite, false);
      const tileIds = new Set(before.tileIds);
      const start = performance.now();
      for (let i = 0; i < 12; i++) {
        await click(i % 2 ? 'Map' : 'Satellite');
        const current = await evaluate('inspectMap()');
        assert.equal(current.tileLayers, 1, 'Only one active background');
        assert.equal(current.controls, 1, 'Only one switch');
        assert.equal(current.overlayId, before.overlayId, 'Switch must not recreate grave layers');
        assert.equal(current.overlayPresent, true);
        assert.equal(current.overlayColor, '#1687C9');
        assert.equal(current.satellite, i % 2 === 0, kind + ' switch ' + i + ': ' + JSON.stringify(current));
        assert.equal(current.attributionVisible, true);
        if (current.satellite) { assert.ok(current.attribution.includes('Esri')); assert.equal(current.imageryFilter, 'none'); }
        tileIds.add(current.tileIds[0]);
      }
      assert.equal(tileIds.size, 2, 'Reuse two layer instances instead of allocating on every switch');
      await click('Satellite');
      assert.deepEqual(await evaluate('(() => {const s=inspectMap();return [s.nativeZoom,s.buffer,s.idle,s.duringZoom]})()'), [18, 1, true, false]);
      await evaluate('fixtureOverlay.fire("click"); void fixtureOverlay.openPopup();');
      assert.ok(await evaluate('overlayClicks > 0 && document.querySelector(".leaflet-popup-content").textContent === "Existing plot popup"'));
      await evaluate('void fixtureMap.setZoom(24, {animate:false});');
      await delay(120);
      assert.ok(await evaluate('tileRequests.every(tile => tile.zoom <= (tile.satellite ? 18 : 19))'), 'Do not request unsupported high zoom tiles');
      await evaluate('changeCemetery("new")');
      await waitFor('fixtureMap._loaded && fixtureMap._mapPane && fixtureMap.getCenter().lat < 13.932 && inspectMap().satellite');
      await evaluate('changeCemetery("old")');
      await waitFor('fixtureMap._loaded && fixtureMap._mapPane && fixtureMap.getCenter().lat > 13.938 && inspectMap().satellite');
      await evaluate('failSatellite = true; void fixtureMap.eachLayer(layer => {if(layer.options.className === "gravetrak-satellite-tiles")layer.redraw()})');
      await waitFor('!inspectMap().satellite && inspectMap().errorMessage.includes("Satellite unavailable")');
      assert.equal((await evaluate('inspectMap()')).tileLayers, 1);
      await evaluate('failSatellite = false');
      await click('Satellite');
      await waitFor('inspectMap().satellite');
      results.push({ kind, switches: 12, activeBackgrounds: 1, reusedLayerInstances: tileIds.size, overlayPreserved: true, popupAndClicks: true, cemeteryPreferencePreserved: true, failureFallback: true, switchCheckMs: Math.round(performance.now() - start) });
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('void fixtureMap.invalidateSize()');
    await delay(150);
    const mobile = await evaluate('inspectMap().rect');
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390 && mobile.y >= 120, 'Mobile switch fits below search controls');
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(output, 'mobile-switch.png'), Buffer.from(screenshot.data, 'base64'));
    assert.deepEqual(errors, [], 'Browser console/runtime errors');

    // The service worker must leave satellite tiles to normal HTTP caching.
    const handlers = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/public/sw.js'), 'utf8'), { self: { addEventListener: (name, fn) => { handlers[name] = fn; } }, URL });
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/1/1' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, 'No satellite offline cache');

    // Check that imagery is actually available at both cemetery locations.
    for (const [name, lat, lng, zoom] of [['old', 13.93848, 121.62078, 18], ['new', 13.93124, 121.62076, 18]]) {
      const n = 2 ** zoom, x = Math.floor((lng + 180) / 360 * n), angle = lat * Math.PI / 180;
      const y = Math.floor((1 - Math.asinh(Math.tan(angle)) / Math.PI) / 2 * n);
      const response = await fetch('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + zoom + '/' + y + '/' + x + '?blankTile=false');
      assert.equal(response.status, 200, name + ' live imagery');
      assert.ok(response.headers.get('content-type').startsWith('image/'));
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 1000, name + ' imagery has content');
      fs.writeFileSync(path.join(output, name + '-imagery-' + zoom + '.jpg'), bytes);
      results.push({ liveImagery: name, zoom, status: response.status, imageBytes: bytes.length });
    }

    console.log(JSON.stringify({ passed: true, results, mobileFits: true, consoleErrors: errors, satelliteOfflineCache: false }, null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { socket?.close(); chrome?.kill(); server?.close(); }
})();
