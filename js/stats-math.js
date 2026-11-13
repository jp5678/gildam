// 통계 집계 (순수 함수). 날짜 경계는 기기의 현지 시간 기준, 주는 월요일 시작.
import { cumulativeDistances } from './geo.js';

const pad = (n) => String(n).padStart(2, '0');

/** 현지 날짜 키 "YYYY-MM-DD" */
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 해당 주 월요일 0시(현지) */
export function startOfWeek(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** 기간 시작 시각 */
export function periodStart(ms, unit) {
  const d = new Date(ms);
  if (unit === 'week') return startOfWeek(ms);
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (unit === 'year') return new Date(d.getFullYear(), 0, 1).getTime();
  throw new Error(`알 수 없는 기간 단위: ${unit}`);
}

/** 이전/다음 기간 시작 (step 은 음수 가능) */
export function shiftPeriod(startMs, unit, step) {
  const d = new Date(startMs);
  if (unit === 'week') d.setDate(d.getDate() + 7 * step);
  else if (unit === 'month') d.setMonth(d.getMonth() + step);
  else d.setFullYear(d.getFullYear() + step);
  return d.getTime();
}

export function periodLabel(startMs, unit) {
  const d = new Date(startMs);
  if (unit === 'week') return `${d.getMonth() + 1}/${d.getDate()}`;
  if (unit === 'month') return `${d.getMonth() + 1}월`;
  return `${d.getFullYear()}`;
}

/** 합계: 개수·거리·이동 시간·상승 */
export function totals(activities) {
  return activities.reduce(
    (acc, a) => ({
      count: acc.count + 1,
      distance: acc.distance + (a.stats?.distance ?? 0),
      time: acc.time + (a.stats?.movingTime ?? 0),
      elevation: acc.elevation + (a.stats?.elevationGain ?? 0),
    }),
    { count: 0, distance: 0, time: 0, elevation: 0 },
  );
}

/**
 * 최근 count 개 기간의 합계 (빈 기간 포함, 오래된 순)
 * @param {'week'|'month'|'year'} unit
 */
export function aggregate(activities, unit, count, now = Date.now()) {
  const current = periodStart(now, unit);
  const starts = Array.from({ length: count }, (_, i) => shiftPeriod(current, unit, i - count + 1));
  return starts.map((start) => {
    const end = shiftPeriod(start, unit, 1);
    const inRange = activities.filter((a) => a.startTime >= start && a.startTime < end);
    return { start, label: periodLabel(start, unit), ...totals(inRange) };
  });
}

/** 보관함 기간 필터: all | week | month | year (현재 기간) */
export function filterByPeriod(activities, period, now = Date.now()) {
  if (period === 'all') return activities;
  const start = periodStart(now, period);
  const end = shiftPeriod(start, period, 1);
  return activities.filter((a) => a.startTime >= start && a.startTime < end);
}

/** 날짜별 합계 Map<"YYYY-MM-DD", { distance, count, types: string[] }> */
export function dayTotals(activities) {
  const map = new Map();
  for (const a of activities) {
    const key = dayKey(a.startTime);
    const prev = map.get(key) ?? { distance: 0, count: 0, types: [] };
    map.set(key, {
      distance: prev.distance + (a.stats?.distance ?? 0),
      count: prev.count + 1,
      types: prev.types.includes(a.type) ? prev.types : [...prev.types, a.type],
    });
  }
  return map;
}

/** 월 달력 (월요일 시작). 주 배열, 각 칸은 { key, day } 또는 null */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => ({ key: `${year}-${pad(month + 1)}-${pad(i + 1)}`, day: i + 1 })),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** 히트맵 단계 0~4 (해당 월 최대 거리 대비) */
export function heatLevel(distance, maxDistance) {
  if (!distance || !maxDistance) return 0;
  return Math.min(4, Math.max(1, Math.ceil((distance / maxDistance) * 4)));
}

/**
 * 거리 dist 를 가장 빨리 지난 시간(s). 일시정지 세그먼트를 넘는 구간은 제외.
 * 구간 끝을 선형 보간해 정확한 거리 기준으로 계산.
 */
export function bestEffort(points, dist) {
  if (points.length < 2 || points.some((p) => p.time == null)) return null;
  const cum = cumulativeDistances(points);
  let best = Infinity;
  let i = 0;
  for (let j = 1; j < points.length; j += 1) {
    if (points[j].seg !== points[j - 1].seg) {
      i = j;
      continue;
    }
    if (cum[j] - cum[i] < dist) continue;
    // i 를 가능한 한 앞으로: cum[j] - cum[i+1] >= dist 인 동안
    while (i + 1 < j && points[i + 1].seg === points[j].seg && cum[j] - cum[i + 1] >= dist) i += 1;
    // 시작점을 정확히 dist 만큼 떨어진 위치로 보간
    const startDist = cum[j] - dist;
    const span = cum[i + 1] - cum[i];
    const r = span > 0 ? (startDist - cum[i]) / span : 0;
    const startTime = points[i].time + r * (points[i + 1].time - points[i].time);
    best = Math.min(best, (points[j].time - startTime) / 1000);
  }
  return Number.isFinite(best) ? best : null;
}

const RECORD_DEFS = Object.freeze([
  { id: 'longest', label: '최장 거리', pick: (a) => a.stats.distance, better: 'max', kind: 'distance' },
  { id: 'longestTime', label: '최장 이동 시간', pick: (a) => a.stats.movingTime, better: 'max', kind: 'duration' },
  { id: 'climb', label: '최대 누적 상승', pick: (a) => a.stats.elevationGain, better: 'max', kind: 'elevation' },
  { id: 'run1k', label: '달리기 1km 최고 기록', types: ['run'], pick: (a) => bestEffort(a.points, 1000), better: 'min', kind: 'duration' },
  { id: 'run5k', label: '달리기 5km 최고 기록', types: ['run'], pick: (a) => bestEffort(a.points, 5000), better: 'min', kind: 'duration' },
  { id: 'run10k', label: '달리기 10km 최고 기록', types: ['run'], pick: (a) => bestEffort(a.points, 10000), better: 'min', kind: 'duration' },
  { id: 'bikeSpeed', label: '자전거 최고 평균 속도(10km 이상)', types: ['bike'], pick: (a) => (a.stats.distance >= 10000 ? a.stats.avgSpeed : null), better: 'max', kind: 'speed' },
]);

/**
 * 개인 최고 기록
 * @returns {{ id: string, label: string, kind: string, value: number, activityId: string, startTime: number, name: string }[]}
 */
export function personalRecords(activities) {
  return RECORD_DEFS.flatMap((def) => {
    const candidates = activities
      .filter((a) => !def.types || def.types.includes(a.type))
      .map((a) => ({ a, v: def.pick(a) }))
      .filter(({ v }) => Number.isFinite(v) && v > 0);
    if (candidates.length === 0) return [];
    const top = candidates.reduce((b, c) => ((def.better === 'max' ? c.v > b.v : c.v < b.v) ? c : b));
    return [{ id: def.id, label: def.label, kind: def.kind, value: top.v, activityId: top.a.id, startTime: top.a.startTime, name: top.a.name }];
  });
}
