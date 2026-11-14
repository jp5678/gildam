// 길담 서비스 워커: 앱 셸·라이브러리 사전 캐시 + 지도 타일 런타임 캐시
// 앱 파일을 바꾸면 VERSION 을 올려야 사용자에게 새 버전이 반영됨 (tests/pwa.test.js 가 목록 누락을 검사)
const VERSION = 'v3.5.0';
const SHELL_CACHE = `gildam-shell-${VERSION}`;
const CDN_CACHE = `gildam-cdn-${VERSION}`;
const TILE_CACHE = 'gildam-tiles';
const TILE_LIMIT = 400;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/activity-types.js',
  './js/activity.js',
  './js/app.js',
  './js/db.js',
  './js/format.js',
  './js/geo.js',
  './js/gpx.js',
  './js/importer.js',
  './js/map.js',
  './js/photo-match.js',
  './js/photos.js',
  './js/privacy.js',
  './js/pwa.js',
  './js/recorder.js',
  './js/replay-math.js',
  './js/route-svg.js',
  './js/settings-store.js',
  './js/share-card.js',
  './js/stats-math.js',
  './js/ui.js',
  './js/video-export.js',
  './js/views/archive.js',
  './js/views/calendar.js',
  './js/views/detail-photos.js',
  './js/views/detail.js',
  './js/views/record.js',
  './js/views/replay-record.js',
  './js/views/replay.js',
  './js/views/settings.js',
  './js/views/share-dialog.js',
  './js/views/stats.js',
  './sample/walking-olympicpark.gpx',
  './sample/running-hangang.gpx',
  './sample/biking-olympicpark.gpx',
  './sample/hiking-bukhansan.gpx',
  './sample/driving-downtown.gpx',
];

const CDN = [
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/idb@8.0.0/+esm',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm',
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs',
];

const TILE_HOSTS = ['tile.openstreetmap.org', 'api.maptiler.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // cache: 'reload' — 브라우저 HTTP 캐시(GitHub Pages max-age=600)를 건너뛰고 서버에서 새로 받음.
      // 이렇게 하지 않으면 배포 직후 새 버전 캐시에 이전 파일이 섞여 들어갈 수 있음
      await (await caches.open(SHELL_CACHE)).addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
      // CDN 은 실패해도 설치는 진행 (온라인에서 다시 캐시됨)
      const cdn = await caches.open(CDN_CACHE);
      await Promise.all(CDN.map((url) => cdn.add(url).catch(() => undefined)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, CDN_CACHE, TILE_CACHE]);
      await Promise.all((await caches.keys()).filter((k) => k.startsWith('gildam-') && !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
  return response;
}

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

// 타일: 네트워크 우선, 오프라인이면 캐시
async function tileNetworkFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      trimCache(TILE_CACHE, TILE_LIMIT);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    // 페이지 이동: 네트워크 우선, 오프라인이면 캐시된 앱 셸
    event.respondWith(fetch(request).catch(async () => (await caches.match('./index.html')) ?? Response.error()));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }
  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(tileNetworkFirst(request));
  }
});
