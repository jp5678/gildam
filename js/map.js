// MapLibre 지도 헬퍼. maplibregl 은 index.html 에서 UMD 스크립트로 로드됨.
import { loadSettings } from './settings-store.js';
import { pairSpeeds, smoothSpeeds, quantileThresholds, bucketOf, bounds, haversine } from './geo.js';
import { formatSpeed } from './format.js';

export const SPEED_COLORS = Object.freeze(['#3b6fd4', '#35a7c2', '#5cbf5a', '#f2b233', '#e2483d']);

const DEFAULT_CENTER = [126.978, 37.5665]; // 서울시청

// MapTiler 키가 없을 때 쓰는 OSM 래스터 스타일 (3D 지형 없음)
const OSM_STYLE = Object.freeze({
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
});

export function hasMapTilerKey() {
  return loadSettings().maptilerKey.length > 0;
}

function styleUrl() {
  const key = loadSettings().maptilerKey;
  return key ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${encodeURIComponent(key)}` : OSM_STYLE;
}

/**
 * @param {HTMLElement} container
 * @param {{ center?: [number, number], zoom?: number, interactive?: boolean }} [opts]
 * @returns {Promise<any>} 스타일 로드가 끝난 maplibregl.Map
 */
export class MapUnavailableError extends Error {}

export const WEBGL_HELP =
  '이 브라우저에서 WebGL 을 사용할 수 없어 배경 지도를 표시하지 못했습니다. 브라우저 설정에서 “하드웨어 가속 사용”을 켜고 다시 시작해 주세요.';

let webglCache = null;

/** WebGL 사용 가능 여부 (하드웨어 가속 꺼짐·GPU 차단 시 false) */
export function webglSupported() {
  if (webglCache != null) return webglCache;
  try {
    const canvas = document.createElement('canvas');
    webglCache = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** 지도 생성. 실패해도 예외를 던지지 않고 거부된 Promise(MapUnavailableError)를 반환 */
export function createMap(container, { center = DEFAULT_CENTER, zoom = 13, interactive = true } = {}) {
  if (!window.maplibregl) return Promise.reject(new MapUnavailableError('지도 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요.'));
  if (!webglSupported()) return Promise.reject(new MapUnavailableError(WEBGL_HELP));
  let map;
  try {
    map = new window.maplibregl.Map({
      container,
      style: styleUrl(),
      center,
      zoom,
      interactive,
      attributionControl: { compact: true },
      preserveDrawingBuffer: true, // 공유 카드·영상 캡처용
    });
  } catch (err) {
    // 컨텍스트 생성이 런타임에 실패하는 경우 (GPU 블랙리스트 등)
    console.error('map init failed', err);
    webglCache = false;
    return Promise.reject(new MapUnavailableError(WEBGL_HELP));
  }
  if (interactive) map.addControl(new window.maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  return new Promise((resolve, reject) => {
    map.once('load', () => resolve(map));
    map.once('error', (e) => {
      if (!map.loaded()) reject(new Error(e?.error?.message ?? '지도를 불러오지 못했습니다. MapTiler 키를 확인해 주세요.'));
    });
  });
}

const toCoord = (p) => [p.lon, p.lat];

/** 속도 구간별 색상 선분 GeoJSON + 범례용 경계값 */
export function speedColoredFeatures(points) {
  const speeds = smoothSpeeds(pairSpeeds(points));
  const thresholds = quantileThresholds(speeds, SPEED_COLORS.length);
  const features = [];
  speeds.forEach((v, i) => {
    if (points[i].seg !== points[i + 1].seg) return;
    const bucket = bucketOf(v, thresholds);
    const color = bucket < 0 ? '#888888' : SPEED_COLORS[bucket];
    const last = features.at(-1);
    // 같은 색이 이어지면 하나의 선으로 합쳐 피처 수를 줄임
    if (last && last.properties.color === color && last.properties.end === i) {
      last.geometry.coordinates.push(toCoord(points[i + 1]));
      last.properties.end = i + 1;
    } else {
      features.push({
        type: 'Feature',
        properties: { color, end: i + 1 },
        geometry: { type: 'LineString', coordinates: [toCoord(points[i]), toCoord(points[i + 1])] },
      });
    }
  });
  return { geojson: { type: 'FeatureCollection', features }, thresholds };
}

export function speedLegend(thresholds) {
  if (thresholds.length === 0) return [];
  return SPEED_COLORS.map((color, i) => {
    const lo = i === 0 ? null : thresholds[i - 1];
    const hi = i === thresholds.length ? null : thresholds[i];
    const label = lo == null ? `~${formatSpeed(hi)}` : hi == null ? `${formatSpeed(lo)}~` : `${formatSpeed(lo)}~${formatSpeed(hi)}`;
    return { color, label };
  });
}

function upsertSource(map, id, data) {
  const src = map.getSource(id);
  if (src) src.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

/** 경로 그리기. colorBySpeed=false 면 단색(color) */
export function drawRoute(map, points, { colorBySpeed = true, color = '#2e9e5b' } = {}) {
  const { geojson, thresholds } = colorBySpeed
    ? speedColoredFeatures(points)
    : {
        geojson: { type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: points.map(toCoord) } },
        thresholds: [],
      };
  upsertSource(map, 'route', geojson);
  if (!map.getLayer('route-casing')) {
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 },
    });
  }
  return thresholds;
}

function markerEl(className, text) {
  const el = document.createElement('div');
  el.className = `map-marker ${className}`;
  el.textContent = text;
  return el;
}

/** 시작(S)/종료(F) 마커. 제거 함수 반환 */
export function addStartEndMarkers(map, points) {
  const start = new window.maplibregl.Marker({ element: markerEl('marker-start', 'S') }).setLngLat(toCoord(points[0])).addTo(map);
  // 원점 회귀 코스는 시작·종료가 겹치므로 종료 마커를 살짝 비켜 표시
  const overlap = haversine(points[0], points.at(-1)) < 30;
  const end = new window.maplibregl.Marker({ element: markerEl('marker-end', 'F'), offset: overlap ? [16, -16] : [0, 0] })
    .setLngLat(toCoord(points.at(-1)))
    .addTo(map);
  return () => {
    start.remove();
    end.remove();
  };
}

export function fitRoute(map, points, { padding = 40, animate = false } = {}) {
  if (points.length === 0) return;
  map.fitBounds(bounds(points), { padding, animate, maxZoom: 16 });
}

/** 현재 위치 점 (기록 화면용) */
export function createPositionMarker(map) {
  const el = document.createElement('div');
  el.className = 'pos-dot';
  const marker = new window.maplibregl.Marker({ element: el });
  let added = false;
  return {
    update(lon, lat) {
      marker.setLngLat([lon, lat]);
      if (!added) {
        marker.addTo(map);
        added = true;
      }
    },
    remove: () => marker.remove(),
  };
}

/** MapTiler 지형(DEM)으로 3D 지형 활성화. 키가 없으면 false */
export function enableTerrain(map, exaggeration = 1.4) {
  const key = loadSettings().maptilerKey;
  if (!key) return false;
  try {
    if (!map.getSource('terrain-dem')) {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(key)}`,
        tileSize: 256,
      });
    }
    map.setTerrain({ source: 'terrain-dem', exaggeration });
    map.setSky?.({ 'sky-color': '#9fc6ea', 'horizon-color': '#e6eef5', 'sky-horizon-blend': 0.6 });
    return true;
  } catch (err) {
    console.error('terrain failed', err);
    return false;
  }
}

/** 사진 썸네일 마커. onClick(photo) 호출. 제거 함수 반환 */
export function addPhotoMarkers(map, photos, points, urls, onClick) {
  const markers = photos.map((photo) => {
    const p = points[Math.min(photo.index, points.length - 1)];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'photo-marker';
    el.setAttribute('aria-label', '사진 보기');
    el.style.backgroundImage = `url("${urls.get(photo.id).thumb}")`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(photo);
    });
    return new window.maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(toCoord(p)).addTo(map);
  });
  return () => markers.forEach((m) => m.remove());
}
