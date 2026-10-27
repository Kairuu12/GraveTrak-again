import { useMemo } from 'react';
import { siteData } from '../data/cemeteryLayout.js';
import newLayout from '../../anothermap.json';
import { closeBoundaryFeatures } from '../utils/mapGeometry.js';

export default function CemeteryLayoutPreview({ cemetery = 'old' }) {
  const paths = useMemo(() => {
    const data = closeBoundaryFeatures(cemetery === 'new' ? newLayout : siteData);
    const shapes = data.features.flatMap(feature => {
      const geometry = feature.geometry;
      const boundary = feature.properties?.type === 'boundary' || feature.properties?.name?.toLowerCase() === 'boundary';
      if (geometry?.type === 'Polygon') return [{ rings: geometry.coordinates, boundary, polygon: true }];
      if (geometry?.type === 'LineString') return [{ rings: [geometry.coordinates], boundary, polygon: false }];
      return [];
    });
    const points = shapes.flatMap(shape => shape.rings.flat());
    if (!points.length) return [];
    const minX = Math.min(...points.map(p => p[0]));
    const maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1]));
    const maxY = Math.max(...points.map(p => p[1]));
    const longitudeScale = Math.cos((minY + maxY) / 2 * Math.PI / 180);
    const width = (maxX - minX) * longitudeScale;
    const height = maxY - minY;
    const scale = Math.min(320 / (width || 1), 270 / (height || 1));
    const project = ([lng, lat]) => `${(190 + ((lng - minX) * longitudeScale - width / 2) * scale).toFixed(2)},${(155 - (lat - minY - height / 2) * scale).toFixed(2)}`;
    return shapes.map(shape => ({
      className: shape.boundary ? 'layout-boundary' : shape.polygon ? 'layout-section' : 'layout-pathway',
      d: shape.rings.map(ring => ring.map((point, i) => `${i ? 'L' : 'M'}${project(point)}`).join(' ') + (shape.polygon ? ' Z' : '')).join(' '),
    }));
  }, [cemetery]);

  return <svg className="cemetery-layout-preview" viewBox="0 0 380 310" role="img" aria-label={`${cemetery === 'new' ? 'New' : 'Old'} Cemetery layout preview`}>
    <title>{cemetery === 'new' ? 'New' : 'Old'} Cemetery base layout</title>
    {paths.map((path, index) => <path key={index} {...path} fillRule="evenodd" />)}
  </svg>;
}
