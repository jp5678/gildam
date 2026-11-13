// 보관함 탭: 활동 목록 + 종류 필터 + 가져오기
import { findAllActivities } from '../db.js';
import { ACTIVITY_TYPES, getType } from '../activity-types.js';
import { importFiles, importSample } from '../importer.js';
import { formatDistance, formatDuration, formatDateTime, formatPace, formatSpeed, esc } from '../format.js';
import { toast, pickFiles } from '../ui.js';

const SAMPLES = Object.freeze([
  { path: 'sample/hiking-bukhansan.gpx', label: '⛰️ 샘플 등산' },
  { path: 'sample/running-hangang.gpx', label: '🏃 샘플 러닝' },
]);

function card(a) {
  const t = getType(a.type);
  const pace = a.type === 'bike' ? formatSpeed(a.stats.avgSpeed) : `${formatPace(a.stats.avgPace)}/km`;
  return `<a class="activity-card" href="#/activity/${encodeURIComponent(a.id)}" style="--accent:${t.color}">
    <span class="activity-icon" aria-hidden="true">${t.icon}</span>
    <span class="activity-main">
      <strong>${esc(a.name)}</strong>
      <small>${esc(formatDateTime(a.startTime))}</small>
    </span>
    <span class="activity-nums">
      <b>${formatDistance(a.stats.distance)}</b>
      <small>${formatDuration(Math.round(a.stats.movingTime))} · ${pace}</small>
    </span>
  </a>`;
}

export async function render(root, { navigate }) {
  let filter = 'all';
  let activities = [];

  root.innerHTML = `
  <section class="view view-archive">
    <header class="view-header">
      <h1>보관함</h1>
      <button class="btn btn-ghost btn-sm" data-action="import">📂 가져오기</button>
    </header>
    <div class="chips chips-scroll" data-ref="filters">
      <button class="chip" data-filter="all">전체</button>
      ${Object.values(ACTIVITY_TYPES)
        .map((t) => `<button class="chip" data-filter="${t.id}" style="--chip:${t.color}">${t.icon} ${t.label}</button>`)
        .join('')}
    </div>
    <div class="activity-list" data-ref="list"><p class="muted">불러오는 중…</p></div>
  </section>`;

  const list = root.querySelector('[data-ref="list"]');

  function draw() {
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    const shown = filter === 'all' ? activities : activities.filter((a) => a.type === filter);
    if (activities.length === 0) {
      list.innerHTML = `<div class="empty">
        <p>아직 기록이 없습니다.</p>
        <p class="muted">기록 탭에서 새 활동을 시작하거나, GPX 파일을 가져오거나, 샘플로 둘러보세요.</p>
        <div class="row">${SAMPLES.map((s) => `<button class="btn btn-secondary" data-sample="${s.path}">${s.label}</button>`).join('')}</div>
      </div>`;
      return;
    }
    list.innerHTML = shown.length ? shown.map(card).join('') : '<p class="muted">해당 종류의 활동이 없습니다.</p>';
  }

  async function reload() {
    try {
      activities = await findAllActivities();
    } catch (err) {
      list.innerHTML = `<p class="error">활동을 불러오지 못했습니다: ${esc(err?.message ?? err)}</p>`;
      return;
    }
    draw();
  }

  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      draw();
      return;
    }
    const sample = e.target.closest('[data-sample]');
    if (sample) {
      try {
        const a = await importSample(sample.dataset.sample);
        navigate(`#/activity/${a.id}`);
      } catch (err) {
        toast(err?.message ?? String(err), { type: 'error' });
      }
      return;
    }
    if (e.target.closest('[data-action="import"]')) {
      const files = await pickFiles({ accept: '.gpx,.tcx', multiple: true });
      if (files.length === 0) return;
      const { saved, failed } = await importFiles(files);
      failed.forEach((x) => toast(`${x.name}: ${x.reason}`, { type: 'error', duration: 5000 }));
      if (saved.length) toast(`${saved.length}개 활동을 가져왔습니다.`);
      reload();
    }
  });

  await reload();
}
