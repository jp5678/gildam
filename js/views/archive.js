// 보관함 탭: 월별 캘린더 히트맵 + 종류·기간 필터 + 활동 목록 + 가져오기
import { findAllActivities } from '../db.js';
import { ACTIVITY_TYPES, getType, usesSpeed } from '../activity-types.js';
import { importFiles, importSample } from '../importer.js';
import { filterByPeriod, dayKey, totals } from '../stats-math.js';
import { calendarHtml } from './calendar.js';
import { formatDistance, formatDuration, formatDateTime, formatPace, formatSpeed, esc } from '../format.js';
import { toast, pickFiles } from '../ui.js';

// 종류별 샘플 (scripts/make-samples.mjs 로 생성한 합성 경로)
// daysAgo: 불러올 때 날짜를 오늘로부터 며칠 전으로 옮김 (시각은 유지) — 통계 '일' 보기에 바로 보이도록
const SAMPLES = Object.freeze([
  { path: 'sample/walking-olympicpark.gpx', label: '🚶 걷기', daysAgo: 1 },
  { path: 'sample/running-hangang.gpx', label: '🏃 달리기', daysAgo: 2 },
  { path: 'sample/biking-olympicpark.gpx', label: '🚴 자전거', daysAgo: 5 },
  { path: 'sample/hiking-bukhansan.gpx', label: '⛰️ 등산', daysAgo: 6 },
  { path: 'sample/driving-downtown.gpx', label: '🚗 자동차', daysAgo: 3 },
]);

const sampleButtons = () =>
  SAMPLES.map((s) => `<button class="btn btn-secondary btn-sm" data-sample="${s.path}">${s.label}</button>`).join('');

const PERIODS = Object.freeze([
  ['all', '전체 기간'],
  ['week', '이번 주'],
  ['month', '이번 달'],
  ['year', '올해'],
]);

function card(a) {
  const t = getType(a.type);
  const pace = usesSpeed(a.type) ? formatSpeed(a.stats.avgSpeed) : `${formatPace(a.stats.avgPace)}/km`;
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
  const now = new Date();
  const view = { type: 'all', period: 'all', day: null, year: now.getFullYear(), month: now.getMonth() };
  let activities = [];

  root.innerHTML = `
  <section class="view view-archive">
    <header class="view-header">
      <h1>보관함</h1>
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-action="samples" aria-expanded="false">🧪 샘플</button>
        <button class="btn btn-ghost btn-sm" data-action="import">📂 가져오기</button>
      </div>
    </header>
    <div class="card sample-panel" data-ref="samples" hidden>
      <p class="hint">종류별 샘플 활동을 불러와 기능을 둘러볼 수 있습니다 (합성 경로). 불러온 샘플은 일반 활동처럼 삭제할 수 있습니다.</p>
      <div class="row">${sampleButtons()}</div>
    </div>
    <div class="calendar card" data-ref="calendar" hidden></div>
    <div class="chips chips-row">
      <button class="chip" data-filter="all">전체</button>
      ${Object.values(ACTIVITY_TYPES)
        .map((t) => `<button class="chip" data-filter="${t.id}" style="--chip:${t.color}">${t.icon} ${t.label}</button>`)
        .join('')}
    </div>
    <div class="chips chips-row">
      ${PERIODS.map(([id, label]) => `<button class="chip chip-sm" data-period="${id}">${label}</button>`).join('')}
    </div>
    <p class="list-summary" data-ref="summary"></p>
    <div class="activity-list" data-ref="list"><p class="muted">불러오는 중…</p></div>
  </section>`;

  const $ = (n) => root.querySelector(`[data-ref="${n}"]`);

  function visible() {
    const byType = view.type === 'all' ? activities : activities.filter((a) => a.type === view.type);
    return view.day ? byType.filter((a) => dayKey(a.startTime) === view.day) : filterByPeriod(byType, view.period);
  }

  function draw() {
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === view.type)));
    root.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(!view.day && b.dataset.period === view.period)));
    if (activities.length === 0) {
      $('calendar').hidden = true;
      $('summary').textContent = '';
      $('list').innerHTML = `<div class="empty">
        <p>아직 기록이 없습니다.</p>
        <p class="muted">기록 탭에서 새 활동을 시작하거나, GPX 파일을 가져오거나, 샘플로 둘러보세요.</p>
        <p class="muted">샘플 불러오기</p>
        <div class="row">${sampleButtons()}</div>
      </div>`;
      return;
    }
    $('calendar').hidden = false;
    const typeFiltered = view.type === 'all' ? activities : activities.filter((a) => a.type === view.type);
    $('calendar').innerHTML = calendarHtml(typeFiltered, { year: view.year, month: view.month, selected: view.day });
    const shown = visible();
    const sum = totals(shown);
    $('summary').innerHTML = view.day
      ? `${esc(view.day)} · ${sum.count}회 · ${formatDistance(sum.distance)} <button class="link-btn" data-clear-day>날짜 선택 해제</button>`
      : `${sum.count}회 · ${formatDistance(sum.distance)} · ${formatDuration(Math.round(sum.time))}`;
    $('list').innerHTML = shown.length ? shown.map(card).join('') : '<p class="muted">조건에 맞는 활동이 없습니다.</p>';
  }

  async function reload() {
    try {
      activities = await findAllActivities();
    } catch (err) {
      $('list').innerHTML = `<p class="error">활동을 불러오지 못했습니다: ${esc(err?.message ?? err)}</p>`;
      return;
    }
    draw();
  }

  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filter]');
    const p = e.target.closest('[data-period]');
    const day = e.target.closest('[data-day]');
    const cal = e.target.closest('[data-cal]');
    if (f) view.type = f.dataset.filter;
    else if (p) {
      view.period = p.dataset.period;
      view.day = null;
    } else if (day) view.day = view.day === day.dataset.day ? null : day.dataset.day;
    else if (e.target.closest('[data-clear-day]')) view.day = null;
    else if (cal) {
      const d = new Date(view.year, view.month + Number(cal.dataset.cal), 1);
      view.year = d.getFullYear();
      view.month = d.getMonth();
    }
    if (f || p || day || cal || e.target.closest('[data-clear-day]')) return draw();

    const toggle = e.target.closest('[data-action="samples"]');
    if (toggle) {
      const panel = $('samples');
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    const sample = e.target.closest('[data-sample]');
    if (sample) {
      try {
        const def = SAMPLES.find((s) => s.path === sample.dataset.sample);
        const a = await importSample(sample.dataset.sample, { daysAgo: def?.daysAgo ?? null });
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
