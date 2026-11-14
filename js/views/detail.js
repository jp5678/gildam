// 활동 상세: 속도 색상 경로, 요약 통계, 고도 프로필, 1km 구간 표
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm';
import { findActivity, saveActivity, deleteActivity } from '../db.js';
import { ACTIVITY_TYPES, getType, usesSpeed } from '../activity-types.js';
import { updateActivity } from '../activity.js';
import { elevationProfile, splits } from '../geo.js';
import { createMap, drawRoute, addStartEndMarkers, addPhotoMarkers, addNoteMarkers, fitRoute, speedLegend, speedColoredFeatures } from '../map.js';
import { mountPhotoSection, openLightbox, photoCaption } from './detail-photos.js';
import { mountNoteSection, noteCaption } from './detail-notes.js';
import { openNoteViewer } from './note-dialog.js';
import { openShareDialog } from './share-dialog.js';
import { routeSvg } from '../route-svg.js';
import { toGpx } from '../gpx.js';
import { loadSettings } from '../settings-store.js';
import * as fmt from '../format.js';
import { toast, confirmDialog, downloadText, safeFileName } from '../ui.js';

Chart.register(...registerables);

function statsGrid(a) {
  const s = a.stats;
  const isBike = usesSpeed(a.type);
  const items = [
    ['거리', fmt.formatDistance(s.distance)],
    ['이동 시간', fmt.formatDuration(Math.round(s.movingTime))],
    ['경과 시간', fmt.formatDuration(Math.round(s.elapsed))],
    isBike ? ['평균 속도', fmt.formatSpeed(s.avgSpeed)] : ['평균 페이스', `${fmt.formatPace(s.avgPace)}/km`],
    ['최고 속도', fmt.formatSpeed(s.maxSpeed)],
    ['누적 상승', fmt.formatElevation(s.elevationGain)],
    ['최고 고도', fmt.formatElevation(s.maxEle)],
    getType(a.type).met > 0 ? ['칼로리*', fmt.formatCalories(s.calories)] : ['최저 고도', fmt.formatElevation(s.minEle)],
  ];
  return items.map(([k, v]) => `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${k}</span></div>`).join('');
}

function splitsTable(points) {
  const rows = splits(points);
  if (rows.length === 0) return '<p class="muted">시간 정보가 없어 구간 페이스를 계산할 수 없습니다.</p>';
  const best = Math.min(...rows.filter((r) => r.distance >= 1000).map((r) => r.pace));
  return `<table class="splits"><thead><tr><th>km</th><th>페이스</th><th>시간</th><th>고도</th></tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr class="${r.pace === best ? 'best' : ''}">
        <td>${r.distance < 1000 ? (r.index - 1 + r.distance / 1000).toFixed(2) : r.index}</td>
        <td>${fmt.formatPace(r.pace)}</td>
        <td>${fmt.formatDuration(Math.round(r.time))}</td>
        <td>${r.eleDelta == null ? '-' : `${r.eleDelta >= 0 ? '+' : ''}${Math.round(r.eleDelta)}m`}</td></tr>`,
      )
      .join('')}
  </tbody></table>`;
}

function elevationChart(canvas, points, color) {
  const data = elevationProfile(points);
  if (data.length < 2) return null;
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--text-2').trim() || '#666';
  const grid = css.getPropertyValue('--line').trim() || '#ddd';
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          data: data.map((d) => ({ x: d.km, y: d.ele })),
          borderColor: color,
          backgroundColor: `${color}33`,
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (i) => `${i[0].parsed.x.toFixed(2)} km`, label: (i) => `고도 ${Math.round(i.parsed.y)} m` } },
      },
      scales: {
        x: { type: 'linear', min: 0, max: data.at(-1).km, ticks: { color: text, callback: (v) => `${Math.round(v * 10) / 10}km` }, grid: { color: grid } },
        y: { ticks: { color: text, callback: (v) => `${v}m` }, grid: { color: grid } },
      },
    },
  });
}

export async function render(root, { params, navigate }) {
  let activity = await findActivity(params.id);
  if (!activity) {
    root.innerHTML = `<section class="view"><p class="error">활동을 찾을 수 없습니다.</p><a class="btn btn-ghost" href="#/archive">보관함으로</a></section>`;
    return;
  }
  const t = () => getType(activity.type);

  root.innerHTML = `
  <section class="view view-detail">
    <header class="view-header">
      <a class="btn btn-ghost btn-sm" href="#/archive" aria-label="보관함으로">←</a>
      <input class="title-input" data-ref="name" maxlength="80" aria-label="활동 이름">
    </header>
    <div class="detail-meta">
      <select data-ref="type" aria-label="활동 종류">
        ${Object.values(ACTIVITY_TYPES).map((x) => `<option value="${x.id}">${x.icon} ${x.label}</option>`).join('')}
      </select>
      <span class="muted" data-ref="date"></span>
    </div>
    <div class="detail-map" data-ref="map"><div class="map-placeholder">지도를 불러오는 중…</div></div>
    <a class="btn btn-primary btn-block replay-cta" data-ref="replay">▶ 3D 리플레이</a>
    <div class="legend" data-ref="legend"></div>
    <div class="stats-grid" data-ref="stats"></div>
    <p class="footnote" data-ref="foot"></p>
    <h2>고도 프로필</h2>
    <div class="chart-box"><canvas data-ref="chart"></canvas></div>
    <h2>구간 페이스</h2>
    <div data-ref="splits"></div>
    <section data-ref="photos"></section>
    <section data-ref="notes"></section>
    <div class="row actions">
      <button class="btn btn-secondary" data-action="share">🖼 공유 카드</button>
      <button class="btn btn-secondary" data-action="gpx">⬇ GPX 내보내기</button>
      <button class="btn btn-danger-ghost" data-action="delete">삭제</button>
    </div>
  </section>`;

  const $ = (n) => root.querySelector(`[data-ref="${n}"]`);
  $('name').value = activity.name;
  $('type').value = activity.type;
  $('date').textContent = fmt.formatDateTime(activity.startTime);
  $('splits').innerHTML = splitsTable(activity.points);
  $('replay').href = `#/replay/${encodeURIComponent(activity.id)}`;

  let chart = null;
  function drawSummary() {
    $('stats').innerHTML = statsGrid(activity);
    const filtered = activity.filteredCount ? ` GPS 튐으로 판단된 ${activity.filteredCount}개 지점은 제외했습니다.` : '';
    const calNote = t().met > 0 ? `* 칼로리는 활동 종류 MET × 체중(${loadSettings().weightKg}kg) × 이동 시간으로 계산한 추정치입니다.` : '';
    $('foot').textContent = `${calNote}${filtered}`.trim();
    chart?.destroy();
    chart = elevationChart($('chart'), activity.points, t().color);
    if (!chart) $('chart').parentElement.innerHTML = '<p class="muted">고도 정보가 없습니다.</p>';
  }
  drawSummary();

  let map = null;
  let removeMarkers = null;
  let removePhotoMarkers = null;
  let photoState = { photos: [], urls: null };
  let notes = [];
  let removeNoteMarkers = null;
  let fallbackError = null; // WebGL 이 없어 SVG 대체 지도를 쓰는 경우 그 사유

  const openPhoto = (photo) => openLightbox(photoState.urls.get(photo.id).full, photoCaption(photo, activity.points));
  const openNote = (note) => openNoteViewer(noteCaption(note, activity.points), note.text);

  // WebGL 이 없으면 배경 지도 없이 SVG 경로 + 사진 썸네일로 표시
  function drawFallbackMap() {
    const { geojson, thresholds } = speedColoredFeatures(activity.points);
    const photos = photoState.urls ? photoState.photos.map((p) => ({ id: p.id, index: p.index, thumb: photoState.urls.get(p.id).thumb })) : [];
    $('map').classList.add('map-fallback');
    $('map').innerHTML = `${routeSvg(activity.points, { features: geojson.features, photos, notes })}
      <p class="map-fallback-note">${fmt.esc(fallbackError)}</p>`;
    $('legend').innerHTML = speedLegend(thresholds)
      .map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`)
      .join('');
  }

  function drawPhotoMarkers() {
    removePhotoMarkers?.();
    removePhotoMarkers = null;
    if (fallbackError) return drawFallbackMap();
    if (!map || !photoState.urls || photoState.photos.length === 0) return;
    removePhotoMarkers = addPhotoMarkers(map, photoState.photos, activity.points, photoState.urls, openPhoto);
  }

  function drawNoteMarkers() {
    removeNoteMarkers?.();
    removeNoteMarkers = null;
    if (fallbackError) return drawFallbackMap();
    if (!map || notes.length === 0) return;
    removeNoteMarkers = addNoteMarkers(map, notes, activity.points, openNote);
  }

  mountNoteSection($('notes'), () => activity, (next) => {
    notes = next;
    drawNoteMarkers();
  }).catch((err) => {
    $('notes').innerHTML = `<p class="error">메모를 불러오지 못했습니다: ${fmt.esc(err?.message ?? err)}</p>`;
  });

  const photoSection = mountPhotoSection($('photos'), () => activity, (photos, urls) => {
    photoState = { photos, urls };
    drawPhotoMarkers();
  }).catch((err) => {
    $('photos').innerHTML = `<p class="error">사진을 불러오지 못했습니다: ${fmt.esc(err?.message ?? err)}</p>`;
    return null;
  });

  createMap($('map'), { interactive: true })
    .then((m) => {
      map = m;
      const thresholds = drawRoute(map, activity.points, { colorBySpeed: true });
      removeMarkers = addStartEndMarkers(map, activity.points);
      fitRoute(map, activity.points);
      drawNoteMarkers();
      drawPhotoMarkers();
      $('legend').innerHTML = speedLegend(thresholds)
        .map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`)
        .join('');
    })
    .catch((err) => {
      fallbackError = err.message;
      drawFallbackMap();
    });

  // 대체 지도의 사진 썸네일·메모 마커 클릭·키보드
  const onFallbackPhoto = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest?.('.svg-photo');
    const photo = g && photoState.photos.find((p) => p.id === g.dataset.photoId);
    if (photo) return openPhoto(photo);
    const ng = e.target.closest?.('.svg-note');
    const note = ng && notes.find((n) => n.id === ng.dataset.noteId);
    if (note) openNote(note);
  };
  $('map').addEventListener('click', onFallbackPhoto);
  $('map').addEventListener('keydown', onFallbackPhoto);

  async function persist(patch) {
    activity = updateActivity(activity, patch, loadSettings().weightKg);
    await saveActivity(activity);
    drawSummary();
  }

  $('name').addEventListener('change', () => persist({ name: $('name').value }).catch((e) => toast(e.message, { type: 'error' })));
  $('type').addEventListener('change', () => persist({ type: $('type').value }).catch((e) => toast(e.message, { type: 'error' })));

  root.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'share') {
      openShareDialog(activity).catch((err) => toast(`공유 카드를 만들지 못했습니다: ${err?.message ?? err}`, { type: 'error' }));
    } else if (action === 'gpx') {
      downloadText(`${safeFileName(activity.name)}.gpx`, toGpx(activity), 'application/gpx+xml');
    } else if (action === 'delete') {
      if (!(await confirmDialog(`'${activity.name}' 활동을 삭제할까요? 되돌릴 수 없습니다.`))) return;
      await deleteActivity(activity.id);
      toast('삭제했습니다.');
      navigate('#/archive');
    }
  });

  return () => {
    chart?.destroy();
    removePhotoMarkers?.();
    removeNoteMarkers?.();
    photoSection.then((s) => s?.destroy());
    removeMarkers?.();
    map?.remove();
  };
}
