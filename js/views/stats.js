// 통계 탭: 주/월/연 누적 차트, 전체 합계, 개인 최고 기록
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/+esm';
import { findAllActivities } from '../db.js';
import { ACTIVITY_TYPES } from '../activity-types.js';
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
    <div class="chips chips-row">
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
    <div data-ref="records"></div>
  </section>`;

  const $ = (n) => root.querySelector(`[data-ref="${n}"]`);

  /** '전체'는 종류별 누적 막대, 특정 종류는 단일 막대 */
  function drawChart(list, buckets) {
    const metric = METRICS[state.metric];
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--text-2').trim() || '#666';
    const grid = css.getPropertyValue('--line').trim() || '#ddd';
    const unit = UNITS[state.unit];
    const series =
      state.type === 'all'
        ? Object.values(ACTIVITY_TYPES)
            .filter((t) => list.some((a) => a.type === t.id))
            .map((t) => ({ type: t, buckets: aggregate(list.filter((a) => a.type === t.id), state.unit, unit.count) }))
        : [{ type: ACTIVITY_TYPES[state.type], buckets }];
    const stacked = series.length > 1;
    chart?.destroy();
    chart = new Chart($('chart'), {
      type: 'bar',
      data: {
        labels: buckets.map((b) => b.label),
        datasets: series.map((s) => ({
          label: `${s.type.icon} ${s.type.label}`,
          data: s.buckets.map(metric.toValue),
          counts: s.buckets.map((b) => b.count),
          backgroundColor: s.type.color,
          borderRadius: stacked ? 0 : 6,
          maxBarThickness: 36,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: stacked, position: 'bottom', labels: { color: text, boxWidth: 12 } },
          tooltip: {
            filter: (i) => i.parsed.y > 0,
            callbacks: { label: (i) => `${i.dataset.label} ${metric.tip(i.parsed.y)} · ${i.dataset.counts[i.dataIndex]}회` },
          },
        },
        scales: {
          x: { stacked, ticks: { color: text }, grid: { display: false } },
          y: { stacked, beginAtZero: true, ticks: { color: text, callback: metric.axis }, grid: { color: grid } },
        },
      },
    });
  }

  function recordCard(r) {
    return `<a class="record" href="#/activity/${encodeURIComponent(r.activityId)}">
      <span class="record-label">${esc(r.label)}</span>
      <b>${formatRecord(r)}</b>
      <small>${esc(r.name)} · ${esc(formatDateTime(r.startTime))}</small>
    </a>`;
  }

  function draw() {
    root.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
    root.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
    root.querySelectorAll('[data-metric]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric)));
    const list = state.type === 'all' ? all : all.filter((a) => a.type === state.type);
    const buckets = aggregate(list, state.unit, UNITS[state.unit].count);
    drawChart(list, buckets);
    const cur = buckets.at(-1);
    const unitName = { week: '이번 주', month: '이번 달', year: '올해' }[state.unit];
    $('current').textContent = `${unitName}: ${cur.count}회 · ${formatDistance(cur.distance)} · ${formatDuration(Math.round(cur.time))}`;
    $('totals').innerHTML = summaryCards(totals(list));
    $('typeNote').textContent = '';
    // 운동 기록과 자동차 기록을 나눠 표시 (운전 거리가 운동 기록을 차지하지 않도록)
    const records = personalRecords(list);
    const groups = [
      ['exercise', '💪 운동', records.filter((r) => r.group === 'exercise')],
      ['car', '🚗 자동차', records.filter((r) => r.group === 'car')],
    ].filter(([, , items]) => items.length);
    $('records').innerHTML = groups.length
      ? groups
          .map(([, title, items]) => `${groups.length > 1 ? `<h3 class="records-title">${title}</h3>` : ''}<div class="records">${items.map(recordCard).join('')}</div>`)
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
