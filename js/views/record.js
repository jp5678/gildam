// 기록 탭: 실시간 GPS 기록 + 파일 가져오기
import { recorder, wakeLockSupported, geolocationSupported } from '../recorder.js';
import { ACTIVITY_TYPES, getType, usesSpeed } from '../activity-types.js';
import { buildActivity } from '../activity.js';
import { cumulativeDistances } from '../geo.js';
import { saveActivity, newId, loadDraft, clearDraft } from '../db.js';
import { loadSettings } from '../settings-store.js';
import { createMap, drawRoute, createPositionMarker } from '../map.js';
import { routeSvg } from '../route-svg.js';
import { importFiles } from '../importer.js';
import { addLivePhoto, countDraftPhotos, attachDraftPhotos, discardDraftPhotos } from '../photos.js';
import { addLiveNote, countDraftNotes, attachDraftNotes, discardDraftNotes } from '../notes.js';
import { openNoteEditor } from './note-dialog.js';
import { formatDistance, formatDuration, formatPace, formatSpeed, esc } from '../format.js';
import { toast, confirmDialog, pickFiles } from '../ui.js';

const TEMPLATE = `
<section class="view view-record">
  <div class="record-map" data-ref="map"><div class="map-placeholder">지도를 불러오는 중…</div></div>
  <div class="record-panel">
    <div class="banner" data-ref="draft" hidden></div>
    <div class="banner banner-warn" data-ref="notice" hidden></div>
    <div class="chips" data-ref="types" role="radiogroup" aria-label="활동 종류">
      ${Object.values(ACTIVITY_TYPES)
        .map((t) => `<button class="chip" role="radio" data-type="${t.id}" style="--chip:${t.color}">${t.icon} ${t.label}</button>`)
        .join('')}
    </div>
    <div class="live-stats">
      <div><span class="live-value" data-ref="time">0:00</span><span class="live-label">시간</span></div>
      <div><span class="live-value" data-ref="dist">0 m</span><span class="live-label">거리</span></div>
      <div><span class="live-value" data-ref="pace">-</span><span class="live-label" data-ref="paceLabel">평균 페이스</span></div>
    </div>
    <p class="gps-status" data-ref="gps">GPS 신호 확인 중…</p>
    <div class="controls" data-ref="controls"></div>
    <div class="controls-extra" data-ref="extra" hidden></div>
    <button class="btn btn-ghost btn-block" data-action="import">📂 GPX/TCX 파일 가져오기</button>
  </div>
</section>`;

// 처리 중인 사진·메모 저장. 화면을 옮겨도 이어지므로 모듈에 둠.
// 종료할 때 이것을 기다려야, 저장이 끝나기 전에 누른 종료로 사진이 활동에 연결되지 않는 일이 없음
const pendingSaves = new Set();
let savingPhotos = 0;

function track(promise) {
  pendingSaves.add(promise);
  promise.finally(() => pendingSaves.delete(promise)).catch(() => {});
  return promise;
}

const waitPendingSaves = () => Promise.allSettled([...pendingSaves]);

/** "사진 2장·메모 1개" (없으면 빈 문자열) */
function draftSummary(photos, notes) {
  return [photos ? `사진 ${photos}장` : null, notes ? `메모 ${notes}개` : null].filter(Boolean).join('·');
}

export async function render(root, { navigate }) {
  root.innerHTML = TEMPLATE;
  const $ = (name) => root.querySelector(`[data-ref="${name}"]`);
  let selectedType = recorder.state === 'idle' ? loadSettings().defaultType : recorder.snapshot().type;
  let map = null;
  let posMarker = null;
  let followed = false;
  let pendingDraft = null;
  let mapError = null;
  let photoCount = 0;
  let noteCount = 0;

  createMap($('map'), { zoom: 15 })
    .then((m) => {
      map = m;
      posMarker = createPositionMarker(map);
      update(recorder.snapshot());
    })
    .catch((err) => {
      mapError = err.message;
      $('map').classList.add('map-fallback');
      update(recorder.snapshot());
    });

  function showNotice() {
    const msgs = [];
    if (!geolocationSupported()) msgs.push('이 브라우저는 위치 기능을 지원하지 않습니다.');
    if (!window.isSecureContext) msgs.push('위치 기록은 HTTPS 또는 localhost 에서만 동작합니다.');
    if (!wakeLockSupported()) msgs.push('이 브라우저는 화면 꺼짐 방지를 지원하지 않습니다. 기록 중에는 화면을 켜 두세요 (특히 iOS).');
    $('notice').hidden = msgs.length === 0;
    $('notice').innerHTML = msgs.map((m) => `<p>${esc(m)}</p>`).join('');
  }

  const countLabel = (n) => (n ? ` ${n}` : '');

  // 기록·일시정지 중에만 보이는 사진·메모 버튼 줄
  function renderExtra(state) {
    const el = $('extra');
    el.hidden = state === 'idle';
    el.innerHTML =
      state === 'idle'
        ? ''
        : `<button class="btn btn-secondary" data-action="photo" aria-label="사진 찍기">📷 ${savingPhotos ? '저장 중…' : `사진${countLabel(photoCount)}`}</button>
           <button class="btn btn-secondary" data-action="note" aria-label="메모 남기기">📝 메모${countLabel(noteCount)}</button>`;
  }

  function renderControls(state) {
    const c = $('controls');
    if (state === 'idle') c.innerHTML = '<button class="btn btn-primary btn-xl" data-action="start">▶ 기록 시작</button>';
    else if (state === 'recording') c.innerHTML = '<button class="btn btn-secondary btn-xl" data-action="pause">❚❚ 일시정지</button>';
    else
      c.innerHTML = `<button class="btn btn-primary btn-xl" data-action="resume">▶ 계속</button>
        <button class="btn btn-danger btn-xl" data-action="stop">■ 종료</button>`;
    renderExtra(state);
  }

  /** 지금 위치 (없으면 마지막 기록 지점) */
  function currentPlace() {
    const snap = recorder.snapshot();
    const fix = snap.lastFix ?? snap.points.at(-1) ?? null;
    return { lat: fix?.lat ?? null, lon: fix?.lon ?? null, time: Date.now() };
  }

  /** 기록 중 촬영: 촬영 순간의 GPS 위치(없으면 마지막 기록 지점)로 저장 */
  async function takePhoto() {
    const [file] = await pickFiles({ accept: 'image/*', capture: 'environment' });
    if (!file) return;
    // 휴대폰 원본 사진은 줄여서 저장하는 데 몇 초 걸리므로 바로 알려 줌
    savingPhotos += 1;
    renderExtra(recorder.state);
    toast('사진을 저장하는 중…', { duration: 10_000 });
    try {
      await track(addLivePhoto(file, currentPlace()));
      photoCount += 1;
      toast(`사진을 저장했습니다 (${photoCount}장). 기록을 마치면 경로에 표시됩니다.`);
    } catch (err) {
      toast(`사진을 저장하지 못했습니다: ${err?.message ?? err}`, { type: 'error', duration: 7000 });
    } finally {
      savingPhotos -= 1;
      renderExtra(recorder.state);
    }
  }

  /** 기록 중 메모: 입력창을 연 순간의 위치로 저장 (입력하는 동안 이동해도 위치가 바뀌지 않게) */
  async function takeNote() {
    const where = currentPlace();
    const result = await openNoteEditor({ title: '📝 지금 위치에 메모' });
    if (!result) return;
    await track(addLiveNote(result.text, where));
    noteCount += 1;
    renderExtra(recorder.state);
    toast(`메모를 저장했습니다 (${noteCount}개). 기록을 마치면 경로에 표시됩니다.`);
  }

  /** 임시 저장된 사진·메모 개수를 다시 읽어 버튼에 표시 (화면 재진입·이어서 기록) */
  function refreshDraftCounts() {
    Promise.all([countDraftPhotos(), countDraftNotes()])
      .then(([photos, notes]) => {
        photoCount = photos;
        noteCount = notes;
        renderExtra(recorder.state);
      })
      .catch(() => {});
  }

  async function discardDrafts() {
    const [photos, notes] = await Promise.all([discardDraftPhotos().catch(() => 0), discardDraftNotes().catch(() => 0)]);
    photoCount = 0;
    noteCount = 0;
    return { photos, notes };
  }

  function update(snap) {
    const recording = snap.state !== 'idle';
    root.querySelectorAll('[data-type]').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.type === selectedType));
      b.disabled = recording && b.dataset.type !== selectedType;
    });
    $('time').textContent = formatDuration(Math.round(snap.elapsed));
    $('dist').textContent = formatDistance(snap.distance);
    const isBike = usesSpeed(selectedType);
    $('paceLabel').textContent = isBike ? '평균 속도' : '평균 페이스';
    $('pace').textContent = isBike
      ? formatSpeed(snap.movingTime > 0 ? snap.distance / snap.movingTime : NaN)
      : formatPace(snap.distance > 50 ? snap.movingTime / (snap.distance / 1000) : NaN);
    const fix = snap.lastFix;
    const accText = fix ? `GPS 정확도 ±${Math.round(fix.accuracy)}m${fix.accuracy > 30 ? ' (약함 — 기록 제외)' : ''}` : 'GPS 신호 확인 중…';
    const extra = [snap.state === 'paused' ? '일시정지됨' : null, snap.dropped > 0 ? `튐 지점 ${snap.dropped}개 제외` : null, recording && wakeLockSupported() ? (snap.wakeLock ? '화면 켜짐 유지 중' : '화면 꺼짐 방지 해제됨') : null]
      .filter(Boolean)
      .join(' · ');
    $('gps').textContent = extra ? `${accText} · ${extra}` : accText;
    $('gps').classList.toggle('weak', Boolean(fix && fix.accuracy > 30));
    if ($('controls').dataset.state !== snap.state) {
      $('controls').dataset.state = snap.state;
      renderControls(snap.state);
    }
    if (mapError) drawFallback(snap.points);
    if (map) {
      if (snap.points.length > 1) drawRoute(map, snap.points, { colorBySpeed: false, color: getType(selectedType).color });
      if (fix) {
        posMarker.update(fix.lon, fix.lat);
        if (!followed || recording) map.easeTo({ center: [fix.lon, fix.lat], duration: followed ? 500 : 0 });
        followed = true;
      }
    }
  }

  // WebGL 없이 경로 모양만 SVG 로 표시
  function drawFallback(points) {
    const svg = points.length > 1 ? routeSvg(points, { color: getType(selectedType).color }) : '<div class="map-placeholder">기록을 시작하면 경로 모양이 여기에 표시됩니다.</div>';
    $('map').innerHTML = `${svg}<p class="map-fallback-note">${esc(mapError)}</p>`;
  }

  async function finish() {
    const { type, points } = await recorder.stop();
    if (pendingSaves.size) toast('사진 저장을 마무리하는 중…', { duration: 10_000 });
    await waitPendingSaves();
    if (points.length < 2) {
      const removed = await discardDrafts();
      const summary = draftSummary(removed.photos, removed.notes);
      toast(`기록된 지점이 부족해 저장하지 않았습니다.${summary ? ` (${summary}도 삭제)` : ''}`, { type: 'warn' });
      return;
    }
    const activity = buildActivity({ id: newId(), now: Date.now(), points, type, source: 'gps', weightKg: loadSettings().weightKg });
    await saveActivity(activity);
    const attach = (fn, label) =>
      fn(activity).catch((err) => {
        toast(`${label} 연결하지 못했습니다: ${err?.message ?? err}`, { type: 'error' });
        return 0;
      });
    const [photos, notes] = await Promise.all([attach(attachDraftPhotos, '사진을'), attach(attachDraftNotes, '메모를')]);
    photoCount = 0;
    noteCount = 0;
    const summary = draftSummary(photos, notes);
    toast(summary ? `활동을 저장했습니다 (${summary} 포함).` : '활동을 저장했습니다.');
    navigate(`#/activity/${activity.id}`);
  }

  async function checkDraft() {
    if (recorder.state !== 'idle') return;
    const draft = await loadDraft().catch(() => null);
    if (!draft || !Array.isArray(draft.points) || draft.points.length === 0) return;
    const el = $('draft');
    el.hidden = false;
    const dist = cumulativeDistances(draft.points).at(-1) ?? 0;
    el.innerHTML = `<p>마치지 못한 ${esc(getType(draft.type).label)} 기록이 있습니다 (${formatDistance(dist)}).</p>
      <div class="row"><button class="btn btn-primary" data-action="draft-resume">이어서 기록</button>
      <button class="btn btn-ghost" data-action="draft-discard">버리기</button></div>`;
    pendingDraft = draft;
  }

  const actions = {
    photo: takePhoto,
    note: takeNote,
    start: async () => {
      // 이전에 버려지지 않은 임시 사진·메모가 새 기록에 섞이지 않도록 정리
      await waitPendingSaves();
      if (!pendingDraft) await discardDrafts();
      recorder.start(selectedType);
    },
    pause: () => recorder.pause(),
    resume: () => recorder.resume(),
    stop: async () => {
      if (await confirmDialog('기록을 종료하고 저장할까요?')) await finish();
    },
    import: async () => {
      const files = await pickFiles({ accept: '.gpx,.tcx', multiple: true });
      if (files.length === 0) return;
      const { saved, failed } = await importFiles(files);
      failed.forEach((f) => toast(`${f.name}: ${f.reason}`, { type: 'error', duration: 5000 }));
      if (saved.length === 1) navigate(`#/activity/${saved[0].id}`);
      else if (saved.length > 1) {
        toast(`${saved.length}개 활동을 가져왔습니다.`);
        navigate('#/archive');
      }
    },
    'draft-resume': () => {
      const draft = pendingDraft;
      if (!draft) return;
      pendingDraft = null;
      $('draft').hidden = true;
      selectedType = draft.type;
      recorder.start(draft.type, draft);
      refreshDraftCounts();
    },
    'draft-discard': async () => {
      if (!(await confirmDialog('남은 기록을 버릴까요? 되돌릴 수 없습니다.'))) return;
      await clearDraft();
      await discardDrafts();
      $('draft').hidden = true;
    },
  };

  root.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('[data-type]');
    if (typeBtn && !typeBtn.disabled) {
      selectedType = typeBtn.dataset.type;
      if (recorder.state !== 'idle') recorder.setType(selectedType);
      update(recorder.snapshot());
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action && actions[action]) {
      Promise.resolve(actions[action]()).catch((err) => toast(err?.message ?? String(err), { type: 'error' }));
    }
  });

  showNotice();
  if (recorder.state !== 'idle') refreshDraftCounts();
  update(recorder.snapshot());
  checkDraft();
  const unsubscribe = recorder.subscribe({ onChange: update, onError: (msg) => toast(msg, { type: 'error', duration: 5000 }) });
  recorder.preview();
  const ticker = setInterval(() => recorder.state === 'recording' && update(recorder.snapshot()), 1000);

  return () => {
    clearInterval(ticker);
    unsubscribe();
    map?.remove();
  };
}
