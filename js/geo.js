// 순수 계산 모듈: 거리·필터링·통계·구간. DOM/브라우저 API 의존 없음 (Node 테스트 가능).

/**
 * @typedef {{ lat: number, lon: number, ele: number|null, time: number|null, seg: number, acc?: number }} TrackPoint
 */

const EARTH_RADIUS_M = 6371008.8;
const MOVING_SPEED_MIN = 0.3; // m/s 미만은 정지로 간주
const MAX_SPEED_WINDOW_S = 10; // 최고 속도는 최소 10초 구간 평균으로 (GPS 튐 완화)
const ELEVATION_THRESHOLD_M = 3; // 상승고도 노이즈 제거 임계값
const ELEVATION_SMOOTH_WINDOW = 5;

const toRad = (deg) => (deg * Math.PI) / 180;

/** 두 지점 사이 거리(m) */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 새 지점을 받아들일지 판단 (실시간 기록·가져오기 공용).
 * @param {TrackPoint|null} prev 마지막으로 채택된 지점
 * @param {TrackPoint} next 후보 지점
 * @param {{ maxAccuracy?: number, maxSpeed?: number }} opts
 * @returns {{ ok: boolean, reason?: 'accuracy'|'speed'|'time' }}
 */
export function acceptPoint(prev, next, { maxAccuracy = Infinity, maxSpeed = Infinity } = {}) {
  if (Number.isFinite(next.acc) && next.acc > maxAccuracy) return { ok: false, reason: 'accuracy' };
  if (!prev || prev.seg !== next.seg) return { ok: true };
  if (prev.time != null && next.time != null) {
    const dt = (next.time - prev.time) / 1000;
    if (dt <= 0) return { ok: false, reason: 'time' };
    if (haversine(prev, next) / dt > maxSpeed) return { ok: false, reason: 'speed' };
  }
  return { ok: true };
}

/** 정확도·비정상 속도 지점을 제거한 새 배열과 제거 개수 */
export function filterPoints(points, opts = {}) {
  const kept = [];
  let dropped = 0;
  for (const p of points) {
    if (acceptPoint(kept.at(-1) ?? null, p, opts).ok) kept.push(p);
    else dropped += 1;
  }
  return { points: kept, dropped };
}

/** 각 지점까지의 누적 거리(m). 세그먼트(일시정지) 경계는 거리에 포함하지 않음 */
export function cumulativeDistances(points) {
  const out = new Array(points.length);
  let total = 0;
  points.forEach((p, i) => {
    if (i > 0 && points[i - 1].seg === p.seg) total += haversine(points[i - 1], p);
    out[i] = total;
  });
  return out;
}

function movingAverage(values, window) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j += 1) {
      sum += values[j];
      n += 1;
    }
    return sum / n;
  });
}

/** 누적 상승/하강 고도(m): 이동평균 후 임계값 히스테리시스 적용 */
export function elevationChange(points) {
  const eles = points.map((p) => p.ele).filter((e) => Number.isFinite(e));
  if (eles.length < 2) return { gain: 0, loss: 0, min: eles[0] ?? null, max: eles[0] ?? null };
  const smooth = movingAverage(eles, ELEVATION_SMOOTH_WINDOW);
  let gain = 0;
  let loss = 0;
  let ref = smooth[0];
  for (const e of smooth) {
    const diff = e - ref;
    if (diff >= ELEVATION_THRESHOLD_M) {
      gain += diff;
      ref = e;
    } else if (diff <= -ELEVATION_THRESHOLD_M) {
      loss -= diff;
      ref = e;
    }
  }
  return { gain, loss, min: minOf(eles), max: maxOf(eles) };
}

function timedPairs(points) {
  const pairs = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.seg !== b.seg || a.time == null || b.time == null) continue;
    const dt = (b.time - a.time) / 1000;
    if (dt > 0) pairs.push({ i, dt, dist: haversine(a, b) });
  }
  return pairs;
}

/** 이동 시간(s): 정지 구간 제외 */
export function movingTime(points) {
  return timedPairs(points)
    .filter(({ dt, dist }) => dist / dt >= MOVING_SPEED_MIN)
    .reduce((s, { dt }) => s + dt, 0);
}

/** 최고 속도(m/s): 최소 10초 이상 구간의 평균 속도 중 최댓값 */
export function maxSpeed(points, cum = cumulativeDistances(points)) {
  let best = 0;
  let j = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].time == null) continue;
    if (points[j].seg !== points[i].seg) j = i;
    while (j < i && points[j].seg === points[i].seg && (points[i].time - points[j + 1].time) / 1000 >= MAX_SPEED_WINDOW_S) {
      j += 1;
    }
    const dt = (points[i].time - points[j].time) / 1000;
    if (dt >= MAX_SPEED_WINDOW_S) best = Math.max(best, (cum[i] - cum[j]) / dt);
  }
  return best;
}

/** 칼로리 추정(kcal) = MET × 체중(kg) × 이동시간(h) */
export function estimateCalories(met, weightKg, movingSeconds) {
  return met * weightKg * (movingSeconds / 3600);
}

/**
 * 활동 요약 통계
 * @param {TrackPoint[]} points
 * @param {{ met: number, weightKg: number }} opts
 */
export function computeStats(points, { met, weightKg }) {
  const cum = cumulativeDistances(points);
  const distance = cum.at(-1) ?? 0;
  const times = points.map((p) => p.time).filter((t) => t != null);
  const elapsed = times.length > 1 ? (times.at(-1) - times[0]) / 1000 : 0;
  const moving = movingTime(points);
  const elev = elevationChange(points);
  const avgSpeed = moving > 0 ? distance / moving : 0;
  return {
    distance,
    elapsed,
    movingTime: moving,
    avgSpeed,
    avgPace: distance > 0 && moving > 0 ? moving / (distance / 1000) : null, // s/km
    maxSpeed: maxSpeed(points, cum),
    elevationGain: elev.gain,
    elevationLoss: elev.loss,
    minEle: elev.min,
    maxEle: elev.max,
    calories: estimateCalories(met, weightKg, moving),
  };
}

function interpolateTime(points, cum, target) {
  const k = cum.findIndex((d) => d >= target);
  if (k <= 0) return points[Math.max(0, k)].time;
  const span = cum[k] - cum[k - 1];
  const ratio = span > 0 ? (target - cum[k - 1]) / span : 0;
  return points[k - 1].time + ratio * (points[k].time - points[k - 1].time);
}

function interpolateEle(points, cum, target) {
  const k = cum.findIndex((d) => d >= target);
  if (k < 0) return points.at(-1).ele;
  if (k === 0) return points[0].ele;
  const a = points[k - 1].ele;
  const b = points[k].ele;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return b ?? a ?? null;
  const span = cum[k] - cum[k - 1];
  return a + (span > 0 ? (target - cum[k - 1]) / span : 0) * (b - a);
}

/**
 * 구간(기본 1km)별 소요 시간·페이스·고도 변화. 일시정지 시간은 제외하지 않은 경과 기준.
 * @returns {{ index: number, distance: number, time: number, pace: number, eleDelta: number|null }[]}
 */
export function splits(points, unit = 1000) {
  if (points.length < 2 || points.some((p) => p.time == null)) return [];
  const cum = cumulativeDistances(points);
  const total = cum.at(-1);
  const pausedBefore = pauseOffsets(points);
  const out = [];
  for (let start = 0; start < total; start += unit) {
    const end = Math.min(start + unit, total);
    if (end - start < 1) break;
    const t0 = interpolateTime(points, cum, start) - pauseAt(points, cum, pausedBefore, start);
    const t1 = interpolateTime(points, cum, end) - pauseAt(points, cum, pausedBefore, end);
    const time = (t1 - t0) / 1000;
    const e0 = interpolateEle(points, cum, start);
    const e1 = interpolateEle(points, cum, end);
    out.push({
      index: out.length + 1,
      distance: end - start,
      time,
      pace: time / ((end - start) / 1000),
      eleDelta: Number.isFinite(e0) && Number.isFinite(e1) ? e1 - e0 : null,
    });
  }
  return out;
}

// 각 지점 이전까지 누적된 일시정지(세그먼트 사이) 시간(ms)
function pauseOffsets(points) {
  let acc = 0;
  return points.map((p, i) => {
    if (i > 0 && points[i - 1].seg !== p.seg) acc += p.time - points[i - 1].time;
    return acc;
  });
}

function pauseAt(points, cum, offsets, target) {
  const k = cum.findIndex((d) => d >= target);
  return offsets[k < 0 ? offsets.length - 1 : k];
}

/** 지점 쌍별 속도(m/s). 시간 정보가 없으면 null */
export function pairSpeeds(points) {
  const speeds = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.seg !== b.seg) {
      speeds.push(null);
      continue;
    }
    const dt = a.time != null && b.time != null ? (b.time - a.time) / 1000 : 0;
    speeds.push(dt > 0 ? haversine(a, b) / dt : null);
  }
  return speeds;
}

/** 속도 이동평균 (null 은 유지, 평균에서 제외) — 색상 구간 깜빡임 완화 */
export function smoothSpeeds(speeds, window = 9) {
  const half = Math.floor(window / 2);
  return speeds.map((v, i) => {
    if (!Number.isFinite(v)) return v;
    const near = speeds.slice(Math.max(0, i - half), i + half + 1).filter(Number.isFinite);
    return near.reduce((a, b) => a + b, 0) / near.length;
  });
}

/** 속도 배열을 n개 분위 구간으로 나눌 경계값 */
export function quantileThresholds(values, n = 5) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (sorted.length === 0) return [];
  return Array.from({ length: n - 1 }, (_, i) => sorted[Math.floor(((i + 1) / n) * (sorted.length - 1))]);
}

export function bucketOf(value, thresholds) {
  if (!Number.isFinite(value)) return -1;
  const idx = thresholds.findIndex((t) => value <= t);
  return idx < 0 ? thresholds.length : idx;
}

/** 고도 프로필용 [{ km, ele }] (최대 maxPoints 개로 샘플링) */
export function elevationProfile(points, maxPoints = 400) {
  const cum = cumulativeDistances(points);
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  return points
    .map((p, i) => ({ km: cum[i] / 1000, ele: p.ele }))
    .filter((d, i) => Number.isFinite(d.ele) && (i % step === 0 || i === points.length - 1));
}

/** 경계 상자 [[minLon, minLat], [maxLon, maxLat]] */
export function bounds(points) {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  return [
    [minOf(lons), minOf(lats)],
    [maxOf(lons), maxOf(lats)],
  ];
}

// 스프레드 연산자는 수십만 개 배열에서 스택 오버플로가 나므로 reduce 사용
function minOf(values) {
  return values.reduce((m, v) => (v < m ? v : m), Infinity);
}

function maxOf(values) {
  return values.reduce((m, v) => (v > m ? v : m), -Infinity);
}
