// 3D 리플레이: 경로를 따라가는 플라이오버 + 진행 오버레이 + 사진 팝업 (+ 영상 저장은 replay-record.js)
import { findActivity, findPhotos } from '../db.js';
import { getType } from '../activity-types.js';
import { createMap, enableTerrain, addPhotoMarkers, fitRoute, webglSupported, WEBGL_HELP } from '../map.js';
import { createTrack, baseDurationSec, lerpAngle } from '../replay-math.js';
import { createPhotoUrls } from '../photos.js';
import { openLightbox, photoCaption } from './detail-photos.js';
import { mountRecorder } from './replay-record.js';
import { formatDistance, formatDuration, formatElevation, esc } from '../format.js';

const PITCH = 62;
const PHOTO_HOLD_MS = 3000;
const BEARING_SMOOTH_MS = 700;
const INTRO_FLY_MS = 1800;
const SPEEDS = Object.freeze([0.5, 1, 2, 4]);

function followZoom(totalM) {
  if (totalM > 40_000) return 13.2;
  if (totalM > 12_000) return 14.2;
  return 15.4;
}

const TEMPLATE = (a) => `
<section class="view-replay">
  <div class="replay-map" data-ref="map"><div class="map-placeholder">지도를 불러오는 중…</div></div>
  <header class="replay-top">
    <a class="btn btn-ghost btn-sm replay-back" href="#/activity/${encodeURIComponent(a.id)}" aria-label="상세로 돌아가기">←</a>
    <div class="replay-title"><strong>${esc(a.name)}</strong><small data-ref="terrain"></small></div>
  </header>
  <div class="replay-hud" aria-live="off">
    <div><b data-ref="dist">0 m</b><span>거리</span></div>
    <div><b data-ref="time">0:00</b><span>시간</span></div>
    <div><b data-ref="ele">-</b><span>고도</span></div>
  </div>
  <p class="replay-rec" data-ref="rec" hidden></p>
  <button class="replay-photo" data-ref="photo" hidden aria-label="사진 크게 보기"><img alt=""><span></span></button>
  <div class="replay-controls">
    <button class="btn btn-primary replay-play" data-action="toggle" aria-label="재생">▶</button>
    <input type="range" min="0" max="1000" value="0" step="1" data-ref="seek" aria-label="재생 위치">
    <select data-ref="speed" aria-label="재생 속도">${SPEEDS.map((s) => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}×</option>`).join('')}</select>
    <button class="btn btn-ghost replay-record" data-action="record" aria-label="영상으로 저장">🎬</button>
  </div>
</section>`;

export async function render(root, { params }) {
  const activity = await findActivity(params.id);
  if (!activity) {
    root.innerHTML = '<section class="view"><p class="error">활동을 찾을 수 없습니다.</p><a class="btn btn-ghost" href="#/archive">보관함으로</a></section>';
    return;
  }
  if (!webglSupported() || !window.maplibregl) {
    root.innerHTML = `<section class="view"><p class="error">${esc(WEBGL_HELP)}</p><p class="muted">3D 리플레이는 WebGL 이 필요합니다.</p>
      <a class="btn btn-ghost" href="#/activity/${encodeURIComponent(activity.id)}">상세로 돌아가기</a></section>`;
    return;
  }

  root.innerHTML = TEMPLATE(activity);
  const $ = (n) => root.querySelector(`[data-ref="${n}"]`);
  const color = getType(activity.type).color;
  const allPhotos = await findPhotos(activity.id).catch(() => []);
  const urls = createPhotoUrls(allPhotos);

  // 현재 재생 중인 경로 (영상 녹화 시 집 주변을 잘라낸 경로로 교체됨)
  const route = { points: activity.points, photos: allPhotos, track: null, stops: [], duration: 0, lookAhead: 0 };
  const state = { fraction: 0, playing: false, speed: 1, holdUntil: 0, bearing: null, dirty: true, started: false, shown: new Set(), locked: false };
  const listeners = { finish: [] };
  let map = null;
  let marker = null;
  let removePhotoMarkers = null;
  let raf = 0;
  let last = 0;
  let photoTimer = 0;
  let recorderUi = null;

  try {
    map = await createMap($('map'), { interactive: true });
  } catch (err) {
    $('map').innerHTML = `<div class="map-placeholder">${esc(err.message)}</div>`;
    return () => urls.revoke();
  }

  const terrainOn = enableTerrain(map);
  $('terrain').textContent = terrainOn ? '3D 지형' : '평면 지도 · 설정에서 MapTiler 키를 넣으면 3D 지형이 표시됩니다';

  map.addSource('replay-route', { type: 'geojson', lineMetrics: true, data: lineOf(activity.points) });
  map.addLayer({
    id: 'replay-bg',
    type: 'line',
    source: 'replay-route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: 'replay-done',
    type: 'line',
    source: 'replay-route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-width': 6, 'line-gradient': progressGradient(0) },
  });
  const dot = document.createElement('div');
  dot.className = 'replay-dot';
  dot.style.setProperty('--accent', color);
  marker = new window.maplibregl.Marker({ element: dot }).setLngLat([activity.points[0].lon, activity.points[0].lat]).addTo(map);

  function lineOf(points) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) } };
  }

  function progressGradient(f) {
    return ['step', ['line-progress'], color, Math.min(1, Math.max(f, 1e-6)), 'rgba(0,0,0,0)'];
  }

  /** 재생할 경로 교체 (처음 위치로 되돌림) */
  function loadRoute(points, photos) {
    route.points = points;
    route.photos = photos;
    route.track = createTrack(points);
    route.duration = baseDurationSec(route.track.total);
    route.lookAhead = Math.min(400, Math.max(80, route.track.total * 0.03));
    route.stops = photos.map((p) => ({ photo: p, fraction: route.track.fractionOfIndex(p.index) }));
    map.getSource('replay-route').setData(lineOf(points));
    removePhotoMarkers?.();
    removePhotoMarkers = photos.length
      ? addPhotoMarkers(map, photos, points, urls, (photo) => {
          if (state.locked) return;
          pause();
          openLightbox(urls.get(photo.id).full, photoCaption(photo, points));
        })
      : null;
    state.started = false;
    state.bearing = null;
    hidePhoto();
    seek(0);
    fitRoute(map, points, { padding: 60 });
  }

  function hud(pos) {
    return {
      dist: formatDistance(pos.distance),
      time: pos.time != null ? formatDuration(Math.round((pos.time - route.points[0].time) / 1000)) : '-',
      ele: formatElevation(pos.ele),
    };
  }

  function updateHud(pos) {
    const h = hud(pos);
    $('dist').textContent = h.dist;
    $('time').textContent = h.time;
    $('ele').textContent = h.ele;
    $('seek').value = String(Math.round(state.fraction * 1000));
  }

  function hidePhoto() {
    clearTimeout(photoTimer);
    $('photo').hidden = true;
  }

  function showPhoto(photo) {
    const el = $('photo');
    el.querySelector('img').src = urls.get(photo.id).full;
    el.querySelector('span').textContent = photoCaption(photo, route.points);
    el.dataset.id = photo.id;
    el.hidden = false;
    clearTimeout(photoTimer);
    photoTimer = setTimeout(() => (el.hidden = true), PHOTO_HOLD_MS + 600);
  }

  function checkPhotos(now) {
    const stop = route.stops.find((s) => s.fraction <= state.fraction && !state.shown.has(s.photo.id));
    if (!stop) return;
    state.shown.add(stop.photo.id);
    if (state.playing) state.holdUntil = now + PHOTO_HOLD_MS;
    showPhoto(stop.photo);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : 0;
    last = now;
    if (state.playing && now >= state.holdUntil) {
      state.fraction = Math.min(1, state.fraction + (dt / 1000) * (state.speed / route.duration));
      state.dirty = true;
      if (state.fraction >= 1) {
        pause();
        listeners.finish.forEach((fn) => fn());
      }
    }
    if (!state.dirty) return;
    state.dirty = false;
    const pos = route.track.at(state.fraction);
    marker.setLngLat([pos.lon, pos.lat]);
    map.setPaintProperty('replay-done', 'line-gradient', progressGradient(state.fraction));
    updateHud(pos);
    if (state.started) {
      const target = route.track.headingAt(state.fraction, route.lookAhead);
      state.bearing = state.bearing == null ? target : lerpAngle(state.bearing, target, Math.min(1, dt / BEARING_SMOOTH_MS));
      map.jumpTo({ center: [pos.lon, pos.lat], bearing: state.bearing, pitch: PITCH, zoom: followZoom(route.track.total) });
    }
    checkPhotos(now);
  }

  function setPlayButton() {
    const btn = root.querySelector('[data-action="toggle"]');
    btn.textContent = state.playing ? '❚❚' : state.fraction >= 1 ? '↺' : '▶';
    btn.setAttribute('aria-label', state.playing ? '일시정지' : '재생');
  }

  function pause() {
    state.playing = false;
    state.holdUntil = 0;
    setPlayButton();
  }

  function play() {
    if (state.fraction >= 1) seek(0);
    if (!state.started) {
      // 첫 재생: 전체 보기에서 시작 지점으로 비행한 뒤 출발
      const start = route.track.at(state.fraction);
      state.bearing = route.track.headingAt(state.fraction, route.lookAhead);
      state.started = true;
      state.holdUntil = performance.now() + INTRO_FLY_MS;
      map.flyTo({ center: [start.lon, start.lat], zoom: followZoom(route.track.total), pitch: PITCH, bearing: state.bearing, duration: INTRO_FLY_MS });
    }
    state.playing = true;
    setPlayButton();
  }

  function seek(f) {
    state.fraction = Math.min(1, Math.max(0, f));
    // 되감으면 아직 지나지 않은 사진은 다시 보여줌 (지금 위치의 사진은 다시 띄우지 않음)
    state.shown = new Set(route.stops.filter((s) => s.fraction <= state.fraction && state.fraction > 0).map((s) => s.photo.id));
    state.holdUntil = 0;
    state.dirty = true;
    setPlayButton();
  }

  /** 녹화 중에는 사용자 조작을 막음 */
  function setLocked(locked) {
    state.locked = locked;
    root.classList.toggle('is-recording', locked);
    root.querySelectorAll('.replay-controls input, .replay-controls select, [data-action="toggle"]').forEach((el) => (el.disabled = locked));
    const method = locked ? 'disable' : 'enable';
    map.dragPan[method]();
    map.scrollZoom[method]();
    map.touchZoomRotate[method]();
  }

  const controller = {
    map,
    activity,
    get route() {
      return route;
    },
    get speed() {
      return state.speed;
    },
    loadRoute,
    play,
    pause,
    seek,
    setLocked,
    onFinish: (fn) => listeners.finish.push(fn),
    /** 영상 오버레이용 현재 상태 */
    overlay() {
      const pos = route.track.at(state.fraction);
      const h = hud(pos);
      const photoEl = $('photo');
      // DOM 마커는 지도 캔버스에 포함되지 않으므로 현재 위치를 화면 좌표로 넘겨 직접 그림
      const pt = map.project([pos.lon, pos.lat]);
      return {
        dot: { x: pt.x, y: pt.y, cssWidth: map.getContainer().clientWidth, color },
        title: activity.name,
        hud: [
          [h.dist, '거리'],
          [h.time, '시간'],
          [h.ele, '고도'],
        ],
        photo: photoEl.hidden ? null : { img: photoEl.querySelector('img'), caption: photoEl.querySelector('span').textContent },
        attribution: terrainOn ? '© MapTiler © OpenStreetMap contributors' : '© OpenStreetMap contributors',
      };
    },
    setStatus(text) {
      $('rec').hidden = !text;
      $('rec').textContent = text ?? '';
    },
    allPhotos,
  };

  const onClick = (e) => {
    if (state.locked) {
      if (e.target.closest('[data-action="record"]')) recorderUi?.toggle();
      return;
    }
    if (e.target.closest('[data-action="toggle"]')) (state.playing ? pause : play)();
    if (e.target.closest('[data-action="record"]')) recorderUi?.toggle();
    const photoBtn = e.target.closest('[data-ref="photo"]');
    if (photoBtn?.dataset.id) {
      const photo = route.photos.find((p) => p.id === photoBtn.dataset.id);
      pause();
      if (photo) openLightbox(urls.get(photo.id).full, photoCaption(photo, route.points));
    }
  };
  const onKey = (e) => {
    if (state.locked || e.code !== 'Space' || e.target.closest('input, select, textarea')) return;
    e.preventDefault();
    (state.playing ? pause : play)();
  };
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  $('seek').addEventListener('input', () => {
    seek(Number($('seek').value) / 1000);
    if (!state.started && state.fraction > 0) state.started = true;
  });
  $('speed').addEventListener('change', () => {
    state.speed = Number($('speed').value) || 1;
  });
  // 사용자가 지도를 직접 끌면 재생을 멈춤 (카메라 싸움 방지)
  map.on('dragstart', () => state.playing && pause());

  loadRoute(activity.points, allPhotos);
  recorderUi = mountRecorder(controller);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(photoTimer);
    document.removeEventListener('keydown', onKey);
    recorderUi?.destroy();
    removePhotoMarkers?.();
    marker?.remove();
    map?.remove();
    urls.revoke();
  };
}
