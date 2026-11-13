// 통계 탭: 주/월/연 누적 차트, 전체 합계, 개인 최고 기록
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm';
import { findAllActivities } from '../db.js';
import { ACTIVITY_TYPES, exerciseOnly } from '../activity-types.js';
import { aggregate, totals, personalRecords } from '../stats-math.js';
import { formatDistance, formatDuration, formatElevation, formatSpeed, formatDateTime, esc } from '../format.js';

Chart.register(...registerables);

const UNITS = Object.freeze({
  week: { label: '주', count: 12 },
  month: { label: '월', count: 12 },
  year: { label: '연', count: 5 },
});

const METRICS = Object.freeze({
  distance: { label: '거리', toValue: (b) => b.distance / 1000, axis: (v) => `${v}km`, tip: (v) => `${v.toFixed(1)} km` },
  time: { label: '시간', toValue: (b) => b.time / 3600, axis: (v) => `${v}h`, tip: (v) => formatDuration(Math.round(v * 3600)) },
});

function formatRecord(r) {
  if (r.kind === 'distance') return formatDistance(r.value);
  if (r.kind === 'duration') return formatDuration(Math.round(r.value));
  if (r.kind === 'elevation') return formatElevation(r.value);
  return formatSpeed(r.value);
}

function summaryCards(t) {
  return [
    ['활동', `${t.count}회`],
    ['거리', formatDistance(t.distance)],
    ['이동 시간', formatDuration(Math.round(t.time))],
    ['누적 상승', formatElevation(t.elevation)],
  ]
    .map(([k, v]) => `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${k}</span></div>`)
    .join('');
}

export async function render(root) {
  const state = { unit: 'week', metric: 'distance', type: 'all' };
  let all = [];
  let chart = null;

  root.innerHTML = `
  <section class="view view-stats">
    <header class="view-header"><h1>통계</h1></header>
    <div class="chips chips-scroll">
      <button class="chip" data-type="all">전체</button>
      ${Object.values(ACTIVITY_TYPES).map((t) => `<button class="chip" data-type="${t.id}" style="--chip:${t.color}">${t.icon} ${t.label}</button>`).join('')}
    </div>
    <div class="row seg-row">
      <div class="segmented" role="group" aria-label="기간 단위">
        ${Object.entries(UNITS).map(([id, u]) => `<button data-unit="${id}">${u.label}</button>`).join('')}
      </div>
      <div class="segmented" role="group" aria-label="지표">
        ${Object.entries(METRICS).map(([id, m]) => `<button data-metric="${id}">${m.label}</button>`).join('')}
      </div>
    </div>
    <p class="hint" data-ref="typeNote"></p>
    <div class="chart-box chart-tall"><canvas data-ref="chart" aria-label="기간별 누적 차트"></canvas></div>
    <p class="hint" data-ref="current"></p>
    <h2>전체 누적</h2>
    <div class="stats-grid" data-ref="totals"></div>
    <h2>개인 최고 기록</h2>
    <div class="records" data-ref="records"></div>
  </section>`;

  const $ = (n) => root.querySelector(`[data-ref="${n}"]`);

  function drawChart(buckets) {
    const metric = METRICS[state.metric];
    const color = state.type === 'all' ? '#1f8a52' : ACTIVITY_TYPES[state.type].color;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--text-2').trim() || '#666';
    const grid = css.getPropertyValue('--line').trim() || '#ddd';
    chart?.destroy();
    chart = new Chart($('chart'), {
      type: 'bar',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [{ data: buckets.map(metric.toValue), backgroundColor: color, borderRadius: 6, maxBarThickness: 36 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (i) => `${metric.tip(i.parsed.y)} · ${buckets[i.dataIndex].count}회` } },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: text, callback: metric.axis }, grid: { color: grid } },
        },
      },
    });
  }

  function draw() {
    root.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
    root.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
    root.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
    // '전체'는 운동 활동만 (자동차는 자동차 필터에서 따로 봄)
    const list = state.type === 'all' ? exerciseOnly(all) : all.filter((a) => a.type === state.type);
    const buckets = aggregate(list, state.unit, UNITS[state.unit].count);
    drawChart(buckets);
    const cur = buckets.at(-1);
    const unitName = { week: '이번 주', month: '이번 달', year: '올해' }[state.unit];
    $('current').textContent = `${unitName}: ${cur.count}회 · ${formatDistance(cur.distance)} · ${formatDuration(Math.round(cur.time))}`;
    $('totals').innerHTML = summaryCards(totals(list));
    $('typeNote').textContent = state.type === 'all' ? '전체에는 자동차 기록이 포함되지 않습니다.' : '';
    const records = personalRecords(list);
    $('records').innerHTML = records.length
      ? records
          .map(
            (r) => `<a class="record" href="#/activity/${encodeURIComponent(r.activityId)}">
              <span class="record-label">${esc(r.label)}</span>
              <b>${formatRecord(r)}</b>
              <small>${esc(r.name)} · ${esc(formatDateTime(r.startTime))}</small>
            </a>`,
          )
          .join('')
      : '<p class="muted">기록이 쌓이면 개인 최고 기록이 표시됩니다.</p>';
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]');
    const u = e.target.closest('[data-unit]');
    const m = e.target.closest('[data-metric]');
    if (t) state.type = t.dataset.type;
    if (u) state.unit = u.dataset.unit;
    if (m) state.metric = m.dataset.metric;
    if (t || u || m) draw();
  });

  try {
    all = await findAllActivities();
  } catch (err) {
    $('records').innerHTML = `<p class="error">활동을 불러오지 못했습니다: ${esc(err?.message ?? err)}</p>`;
    return () => chart?.destroy();
  }
  draw();
  return () => chart?.destroy();
}
