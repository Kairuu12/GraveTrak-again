import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteCamera } from './routeCamera.js';

function fixture(extra = {}) {
  const events = {}, dom = {}, timers = new Map(), states = [], moves = [];
  let next = 0;
  const container = { addEventListener: (n, f) => dom[n] = f, removeEventListener: n => delete dom[n] };
  const map = { on: (n, f) => events[n] = f, off: n => delete events[n], getContainer: () => container,
    getMaxZoom: () => 22, project: coords => ({subtract: () => coords}), unproject: p => p,
    stop() {}, flyTo: (...args) => moves.push(['focus', ...args]), fitBounds: (...args) => moves.push(['overview', ...args]) };
  const camera = createRouteCamera(map, {onChange: s => states.push(s), schedule: f => { timers.set(++next, f); return next; }, cancel: id => timers.delete(id), ...extra});
  return {camera, events, dom, timers, states, moves, tick: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(f => f()); }};
}
const path = [[13.93,121.62],[13.94,121.63]];

test('overview transitions once to start; GPS reroutes do not reset camera', () => {
  const f = fixture(); f.camera.setRoute(path);
  assert.equal(f.moves[0][0], 'overview');
  f.tick(); assert.deepEqual(f.moves[1][1], path[0]);
  f.camera.setRoute([...path].reverse()); assert.equal(f.moves.length, 2);
  assert.equal(f.states.at(-1).mode, 'ready');
});
test('GPS follows only after Start, pauses on drag, resumes explicitly', () => {
  const f = fixture(); f.camera.setRoute(path); f.camera.updateLocation(path[0]);
  assert.equal(f.moves.length, 1);
  assert.equal(f.camera.start(), true); assert.equal(f.timers.size, 0);
  f.camera.updateLocation(path[1]); assert.deepEqual(f.moves.at(-1)[1], path[1]);
  f.events.dragstart(); const count = f.moves.length;
  f.camera.updateLocation(path[0]); assert.equal(f.moves.length, count);
  f.camera.start(); assert.equal(f.states.at(-1).mode, 'following');
});
test('manual wheel/keyboard interaction cancels preview transition', () => {
  for (const action of ['wheel', 'keydown']) {
    const f = fixture(); f.camera.setRoute(path); f.dom[action]({key:'ArrowRight'}); f.tick();
    assert.equal(f.moves.length, 1); assert.equal(f.states.at(-1).mode, 'paused');
  }
});
test('overview pauses follow and remains until user chooses another view', () => {
  const f = fixture(); f.camera.setRoute(path); f.camera.updateLocation(path[0]); f.camera.start();
  f.camera.overview(); const count = f.moves.length;
  f.camera.updateLocation(path[1]); f.tick(); assert.equal(f.moves.length, count);
});
test('entrance fallback never pretends to follow GPS; signal loss stops following', () => {
  const f = fixture(); f.camera.setRoute(path); assert.equal(f.camera.start(), false);
  f.camera.startPoint(); assert.deepEqual(f.moves.at(-1)[1],path[0]);
  f.camera.updateLocation(path[0]); f.camera.start(); f.camera.loseLocation();
  assert.equal(f.states.at(-1).hasLocation,false); assert.equal(f.camera.start(),false);
});
test('exit or replacement disposes timer and handlers and ignores late updates', () => {
  const f = fixture(); f.camera.setRoute(path); f.camera.dispose(); f.tick();
  f.camera.updateLocation(path[1]); f.camera.start(); f.camera.setRoute(path); f.camera.overview();
  assert.equal(f.moves.length, 1); assert.equal(f.timers.size,0);
  assert.deepEqual(f.events,{}); assert.deepEqual(f.dom,{});
});
test('reduced motion disables camera animation', () => {
  const f = fixture({reducedMotion:true}); f.camera.setRoute(path); f.tick();
  assert.equal(f.moves[0][2].animate,false); assert.equal(f.moves[1][3].animate,false);
});

test('pinch pauses follow and stationary GPS fixes do not restart animation', () => {
  const f = fixture(); f.camera.setRoute(path); f.camera.updateLocation(path[0]); f.camera.start();
  const count = f.moves.length;
  f.camera.updateLocation(path[0]); assert.equal(f.moves.length, count);
  f.dom.touchstart({touches: [{}, {}]});
  f.camera.updateLocation(path[1]); assert.equal(f.moves.length, count);
  assert.equal(f.states.at(-1).started, true);
});
