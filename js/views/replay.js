// 3D 리플레이: 경로를 따라가는 플라이오버 + 진행 오버레이 + 사진 팝업
import { findActivity, findPhotos } from '../db.js';
import { getType } from '../activity-types.js';
import { createMap, enableTerrain, addPhotoMarkers, fitRoute, webglSupported, WEBGL_HELP } from '../map.js';
import { createTrack, baseDurationSec, lerpAngle } from '../replay-math.js';
import { createPhotoUrls } from '../photos.js';
import { openLightbox, photoCaption } from './detail-photos.js';
import { formatDistance, formatDuration, formatElevation, esc } from '../format.js';

const PITCH = 62;
const PHOTO_HOLD_MS = 3000;
const BEARING_SMOOTH_MS = 700;
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
  <button class="replay-photo" data-ref="photo" hidden aria-label="사진 크게 보기"><img alt=""><span></span></button>
  <div class="replay-controls">
    <button class="btn btn-primary replay-play" data-action="toggle" aria-label="재생">▶</button>
    <input type="range" min="0" max="1000" value="0" step="1" data-ref="seek" aria-label="재생 위치">
    <select data-ref="speed" aria-label="재생 속도">${SPEEDS.map((s) => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}×</option>`).join('')}</select>
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
  const track = createTrack(activity.points);
  const duration = baseDurationSec(track.total);
  const lookAhead = Math.min(400, Math.max(80, track.total * 0.03));
  const photos = await findPhotos(activity.id).catch(() => []);
  const urls = createPhotoUrls(photos);
  const photoStops = photos.map((p) => ({ photo: p, fraction: track.fractionOfIndex(p.index) }));

  const state = { fraction: 0, playing: false, speed: 1, holdUntil: 0, bearing: null, dirty: true, started: false, shown: new Set() };
  let map = null;
  let marker = null;
  let removePhotoMarkers = null;
  let raf = 0;
  let last = 0;
  let photoTimer = 0;
  let disposed = false;

  try {
    map = await createMap($('map'), { interactive: true });
  } catch (err) {
    $('map').innerHTML = `<div class="map-placeholder">${esc(err.message)}</div>`;
    return () => urls.revoke();
  }
  if (disposed) return;

  const terrainOn = enableTerrain(map);
  $('terrain').textContent = terrainOn ? '3D 지형' : '평면 지도 · 설정에서 MapTiler 키를 넣으면 3D 지형이 표시됩니다';

  map.addSource('replay-route', {
    type: 'geojson',
    lineMetrics: true, // line-progress 로 진행 구간 표시
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: activity.points.map((p) => [p.lon, p.lat]) } },
  });
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
  if (photos.length) {
    removePhotoMarkers = addPhotoMarkers(map, photos, activity.points, urls, (photo) => {
      pause();
      openLightbox(urls.get(photo.id).full, photoCaption(photo, activity.points));
    });
  }
  fitRoute(map, activity.points, { padding: 60 });

  function progressGradient(f) {
    return ['step', ['line-progress'], color, Math.min(1, Math.max(f, 1e-6)), 'rgba(0,0,0,0)'];
  }

  function updateHud(pos) {
    $('dist').textContent = formatDistance(pos.distance);
    $('time').textContent = pos.time != null ? formatDuration(Math.round((pos.time - activity.points[0].time) / 1000)) : '-';
    $('ele').textContent = formatElevation(pos.ele);
    $('seek').value = String(Math.round(state.fraction * 1000));
  }

  function showPhoto(photo) {
    const el = $('photo');
    el.querySelector('img').src = urls.get(photo.id).full;
    el.querySelector('span').textContent = photoCaption(photo, activity.points);
    el.dataset.id = photo.id;
    el.hidden = false;
    clearTimeout(photoTimer);
    photoTimer = setTimeout(() => (el.hidden = true), PHOTO_HOLD_MS + 600);
  }

  function checkPhotos(now) {
    for (const stop of photoStops) {
      if (stop.fraction <= state.fraction && !state.shown.has(stop.photo.id)) {
        state.shown.add(stop.photo.id);
        if (state.playing) state.holdUntil = now + PHOTO_HOLD_MS;
        showPhoto(stop.photo);
        break; // 한 번에 한 장씩
      }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(100, now - last) : 0;
    last = now;
    if (state.playing && now >= state.holdUntil) {
      state.fraction = Math.min(1, state.fraction + (dt / 1000) * (state.speed / duration));
      state.dirty = true;
      if (state.fraction >= 1) pause();
    }
    if (!state.dirty) return;
    state.dirty = false;
    const pos = track.at(state.fraction);
    marker.setLngLat([pos.lon, pos.lat]);
    map.setPaintProperty('replay-done', 'line-gradient', progressGradient(state.fraction));
    updateHud(pos);
    if (state.started) {
      const target = track.headingAt(state.fraction, lookAhead);
      state.bearing = state.bearing == null ? target : lerpAngle(state.bearing, target, Math.min(1, dt / BEARING_SMOOTH_MS));
      map.jumpTo({ center: [pos.lon, pos.lat], bearing: state.bearing, pitch: PITCH, zoom: followZoom(track.total) });
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
      const start = track.at(state.fraction);
      state.bearing = track.headingAt(state.fraction, lookAhead);
      state.started = true;
      state.holdUntil = performance.now() + 1800;
      map.flyTo({ center: [start.lon, start.lat], zoom: followZoom(track.total), pitch: PITCH, bearing: state.bearing, duration: 1800 });
    }
    state.playing = true;
    setPlayButton();
  }

  function seek(f) {
    state.fraction = Math.min(1, Math.max(0, f));
    // 되감으면 아직 지나지 않은 사진은 다시 보여줌 (지금 위치의 사진은 다시 띄우지 않음)
    photoStops.forEach((s) => {
      if (s.fraction > state.fraction) state.shown.delete(s.photo.id);
      else state.shown.add(s.photo.id);
    });
    state.holdUntil = 0;
    state.dirty = true;
    setPlayButton();
  }

  const onClick = (e) => {
    if (e.target.closest('[data-action="toggle"]')) (state.playing ? pause : play)();
    const photoBtn = e.target.closest('[data-ref="photo"]');
    if (photoBtn?.dataset.id) {
      const photo = photos.find((p) => p.id === photoBtn.dataset.id);
      pause();
      if (photo) openLightbox(urls.get(photo.id).full, photoCaption(photo, activity.points));
    }
  };
  const onKey = (e) => {
    if (e.code === 'Space' && !e.target.closest('input, select, textarea')) {
      e.preventDefault();
      (state.playing ? pause : play)();
    }
  };
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  $('seek').addEventListener('input', () => {
    seek(Number($('seek').value) / 1000);
    if (!state.started && state.fraction > 0) {
      state.started = true;
      state.bearing = null;
    }
  });
  $('speed').addEventListener('change', () => {
    state.speed = Number($('speed').value) || 1;
  });
  // 사용자가 지도를 직접 끌면 재생을 멈춤 (카메라 싸움 방지)
  map.on('dragstart', () => state.playing && pause());

  raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(photoTimer);
    document.removeEventListener('keydown', onKey);
    removePhotoMarkers?.();
    marker?.remove();
    map?.remove();
    urls.revoke();
  };
}
