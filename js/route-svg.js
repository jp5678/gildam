// WebGL 없이 경로를 그리는 SVG 대체 지도 (배경 타일 없음). 공유 카드 썸네일에도 재사용 예정.
import { bounds } from './geo.js';

const SIZE = 1000;
const PAD = 40;

/** 위경도 → SVG 좌표 투영기 (위도에 따른 경도 축소 보정) */
export function makeProjector(points, size = SIZE, pad = PAD) {
  const [[minLon, minLat], [maxLon, maxLat]] = bounds(points);
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = Math.max((maxLon - minLon) * kx, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = (size - pad * 2) / Math.max(w, h);
  const offX = (size - w * scale) / 2;
  const offY = (size - h * scale) / 2;
  return (p) => [offX + (p.lon - minLon) * kx * scale, size - (offY + (p.lat - minLat) * scale)];
}

const fmt = (n) => n.toFixed(1);

/**
 * @param {import('./geo.js').TrackPoint[]} points
 * @param {{ features?: { properties: { color: string }, geometry: { coordinates: number[][] } }[], color?: string }} opts
 * @returns {string} SVG 마크업
 */
export function routeSvg(points, { features = null, color = '#2e9e5b' } = {}) {
  if (points.length < 2) return '';
  const project = makeProjector(points);
  const toPath = (coords) =>
    coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${project({ lon, lat }).map(fmt).join(' ')}`).join('');
  const lines = features
    ? features.map((f) => ({ d: toPath(f.geometry.coordinates), color: f.properties.color }))
    : [{ d: toPath(points.map((p) => [p.lon, p.lat])), color }];
  const [sx, sy] = project(points[0]);
  const [ex, ey] = project(points.at(-1));
  return `<svg class="route-svg" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="경로 모양">
    ${lines.map((l) => `<path d="${l.d}" fill="none" stroke="var(--surface)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${lines.map((l) => `<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    <circle cx="${fmt(ex)}" cy="${fmt(ey)}" r="16" fill="#222" stroke="#fff" stroke-width="4"/>
    <circle cx="${fmt(sx)}" cy="${fmt(sy)}" r="16" fill="#1f8a52" stroke="#fff" stroke-width="4"/>
  </svg>`;
}
