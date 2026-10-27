import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlotFilterStyle, bindPlotHover } from './mapPlotStyle.js';

function plot() {
  return { options: { fillOpacity: .78 }, handlers: {},
    on(events) { Object.assign(this.handlers, events); },
    setStyle(style) { Object.assign(this.options, style); },
  };
}

test('hovering a filtered-out plot cannot restore its full color', () => {
  const layer = plot(); bindPlotHover(layer);
  applyPlotFilterStyle(layer, { fillOpacity: .38, opacity: .45 }, false);
  layer.handlers.mouseover(); assert.equal(layer.options.fillOpacity, .38);
  layer.handlers.mouseout(); assert.equal(layer.options.fillOpacity, .38);
  assert.equal(layer.options.opacity, .45);
});

test('changing and clearing search while hovered restores the latest filter style', () => {
  const layer = plot(); bindPlotHover(layer);
  applyPlotFilterStyle(layer, { fillOpacity: .78, fillColor: 'blue' }, true);
  layer.handlers.mouseover(); assert.equal(layer.options.fillOpacity, .9);
  applyPlotFilterStyle(layer, { fillOpacity: .38, fillColor: 'red' }, false);
  layer.handlers.mouseout(); assert.equal(layer.options.fillOpacity, .38);
  assert.equal(layer.options.fillColor, 'red');
  applyPlotFilterStyle(layer, { fillOpacity: .78 }, true);
  layer.handlers.mouseover();
  layer.setStyle({ weight: .3 });
  layer.handlers.mouseout();
  assert.equal(layer.options.fillOpacity, .78);
  assert.equal(layer.options.weight, .3);
});

test('hover before filters are applied restores the original opacity', () => {
  const layer = plot(); bindPlotHover(layer);
  layer.handlers.mouseover(); layer.handlers.mouseout();
  assert.equal(layer.options.fillOpacity, .78);
});
