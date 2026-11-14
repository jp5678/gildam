// WebGL 없이 경로를 그리는 SVG 대체 지도 (배경 타일 없음). 공유 카드 썸네일에도 재사용 예정.
import { bounds } from './geo.js';

const SIZE = 1000;
const PAD = 40;

function extent(points) {
  const [[minLon, minLat], [maxLon, maxLat]] = bounds(points);
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  return { minLon, minLat, kx, w: Math.max((maxLon - minLon) * kx, 1e-9), h: Math.max(maxLat - minLat, 1e-9) };
}

/** 위경도 → SVG 좌표 투영기 (위도에 따른 경도 축소 보정). height 를 주면 직사각형 영역에 맞춤 */
export function makeProjector(points, size = SIZE, pad = PAD, height = size) {
  const { minLon, minLat, kx, w, h } = extent(points);
  const scale = Math.min((size - pad * 2) / w, (height - pad * 2) / h);
  const offX = (size - w * scale) / 2;
  const offY = (height - h * scale) / 2;
  return (p) => [offX + (p.lon - minLon) * kx * scale, height - (offY + (p.lat - minLat) * scale)];
}

/** 경로 비율에 맞춘 SVG 높이 (가로 SIZE 기준, 너무 납작하거나 길지 않게 제한) */
export function svgHeight(points) {
  const { w, h } = extent(points);
  return Math.round(Math.min(SIZE * 1.4, Math.max(SIZE * 0.45, SIZE * (h / w) + PAD * 2 + PHOTO_ROOM)));
}

const fmt = (n) => n.toFixed(1);
const PHOTO_SIZE = 64;
const PHOTO_ROOM = 90; // 위쪽 사진 말풍선이 잘리지 않을 여유

const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 사진 지점 위에 말풍선처럼 썸네일 (클릭 시 data-photo-id 로 식별)
function photoMarker(ph, [x, y]) {
  const left = x - PHOTO_SIZE / 2;
  const top = y - PHOTO_SIZE - 14;
  const id = attr(ph.id);
  return `<g class="svg-photo" data-photo-id="${id}" role="button" tabindex="0" aria-label="사진 보기">
    <clipPath id="clip-${id}"><rect x="${fmt(left)}" y="${fmt(top)}" width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" rx="10"/></clipPath>
    <path d="M${fmt(x - 8)} ${fmt(y - 16)} L${fmt(x)} ${fmt(y - 4)} L${fmt(x + 8)} ${fmt(y - 16)} Z" fill="#fff"/>
    <rect x="${fmt(left - 4)}" y="${fmt(top - 4)}" width="${PHOTO_SIZE + 8}" height="${PHOTO_SIZE + 8}" rx="13" fill="#fff"/>
    <image href="${attr(ph.thumb)}" x="${fmt(left)}" y="${fmt(top)}" width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${id})"/>
  </g>`;
}

/**
 * @param {import('./geo.js').TrackPoint[]} points
 * @param {{ features?: { properties: { color: string }, geometry: { coordinates: number[][] } }[], color?: string,
 *   photos?: { id: string, index: number, thumb: string }[] }} opts  photos: 썸네일 마커 (thumb 는 object/data URL)
 * @returns {string} SVG 마크업
 */
export function routeSvg(points, { features = null, color = '#2e9e5b', photos = [] } = {}) {
  if (points.length < 2) return '';
  const height = svgHeight(points);
  // 사진이 있으면 위쪽 여백을 더 둬서 말풍선이 잘리지 않게
  const top = photos.length ? PHOTO_ROOM : 0;
  const inner = makeProjector(points, SIZE, PAD, height - top);
  const project = (p) => {
    const [x, y] = inner(p);
    return [x, y + top];
  };
  const toPath = (coords) =>
    coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${project({ lon, lat }).map(fmt).join(' ')}`).join('');
  const lines = features
    ? features.map((f) => ({ d: toPath(f.geometry.coordinates), color: f.properties.color }))
    : [{ d: toPath(points.map((p) => [p.lon, p.lat])), color }];
  const [sx, sy] = project(points[0]);
  const [ex, ey] = project(points.at(-1));
  return `<svg class="route-svg" viewBox="0 0 ${SIZE} ${height}" preserveAspectRatio="xMidYMid meet" role="${photos.length ? 'group' : 'img'}" aria-label="경로 모양">
    ${lines.map((l) => `<path d="${l.d}" fill="none" stroke="var(--surface)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${lines.map((l) => `<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    <circle cx="${fmt(ex)}" cy="${fmt(ey)}" r="16" fill="#222" stroke="#fff" stroke-width="4"/>
    <circle cx="${fmt(sx)}" cy="${fmt(sy)}" r="16" fill="#1f8a52" stroke="#fff" stroke-width="4"/>
    ${photos.map((ph) => photoMarker(ph, project(points[Math.min(Math.max(ph.index, 0), points.length - 1)]))).join('')}
  </svg>`;
}
