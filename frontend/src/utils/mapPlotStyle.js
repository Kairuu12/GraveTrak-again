// Hover is temporary emphasis; it must never override the current filter state.
export function applyPlotFilterStyle(layer, style, matches) {
  layer.options.plotFilterMatches = Boolean(matches);
  layer.options.plotRestStyle = { ...style };
  layer.setStyle({ ...style, fillOpacity: layer.options.plotHovered && matches ? 0.9 : style.fillOpacity });
}

export function bindPlotHover(layer) {
  layer.on({
    mouseover: () => {
      layer.options.plotHovered = true;
      if (!layer.options.plotRestStyle) {
        layer.options.plotRestStyle = { fillOpacity: layer.options.fillOpacity };
      }
      if (layer.options.plotFilterMatches !== false) layer.setStyle({ fillOpacity: 0.9 });
    },
    mouseout: () => {
      layer.options.plotHovered = false;
      // Zoom may have changed border weight while hovered; restore only fill.
      if (layer.options.plotRestStyle) layer.setStyle({ fillOpacity: layer.options.plotRestStyle.fillOpacity });
    },
  });
}
