// 월별 캘린더 히트맵 (보관함 상단)
import { dayTotals, monthGrid, heatLevel, dayKey } from '../stats-math.js';
import { formatDistance } from '../format.js';

const WEEKDAYS = Object.freeze(['일', '월', '화', '수', '목', '금', '토']);

/**
 * @param {object[]} activities 전체 활동
 * @param {{ year: number, month: number, selected: string|null }} view
 * @returns {string} HTML
 */
export function calendarHtml(activities, { year, month, selected }) {
  const totalsByDay = dayTotals(activities);
  const grid = monthGrid(year, month);
  const monthDays = grid.flat().filter(Boolean);
  const monthTotals = monthDays.map((c) => totalsByDay.get(c.key)).filter(Boolean);
  const max = Math.max(0, ...monthTotals.map((t) => t.distance));
  const sumDist = monthTotals.reduce((s, t) => s + t.distance, 0);
  const sumCount = monthTotals.reduce((s, t) => s + t.count, 0);
  const today = dayKey(Date.now());

  const cell = (c, col) => {
    if (!c) return '<span class="cal-cell cal-empty"></span>';
    const t = totalsByDay.get(c.key);
    const level = heatLevel(t?.distance ?? 0, max);
    const title = t ? `${c.key} · ${t.count}회 · ${formatDistance(t.distance)}` : c.key;
    const weekend = col === 0 ? 'sun' : col === 6 ? 'sat' : '';
    const cls = ['cal-cell', `lv${level}`, weekend, c.key === today ? 'today' : '', c.key === selected ? 'selected' : ''].join(' ');
    return t
      ? `<button class="${cls}" data-day="${c.key}" title="${title}" aria-label="${title}" aria-pressed="${c.key === selected}">${c.day}</button>`
      : `<span class="${cls}" title="${title}">${c.day}</span>`;
  };

  return `
    <div class="cal-head">
      <button class="btn btn-ghost btn-sm" data-cal="-1" aria-label="이전 달">‹</button>
      <strong>${year}년 ${month + 1}월</strong>
      <button class="btn btn-ghost btn-sm" data-cal="1" aria-label="다음 달">›</button>
    </div>
    <p class="cal-sum">${sumCount}회 · ${formatDistance(sumDist)}</p>
    <div class="cal-grid" role="grid">
      ${WEEKDAYS.map((w, i) => `<span class="cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}
      ${grid.flat().map((c, i) => cell(c, i % 7)).join('')}
    </div>`;
}
