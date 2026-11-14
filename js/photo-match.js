// 사진 → 경로 위 위치 매칭 (순수 함수). EXIF GPS 우선, 없으면 촬영 시각.
import { haversine } from './geo.js';

export const MAX_GPS_DISTANCE_M = 1000; // 경로에서 이보다 멀면 GPS 매칭 실패로 간주
export const TIME_TOLERANCE_MS = 10 * 60 * 1000; // 활동 시작 전·종료 후 허용 범위

/**
 * EXIF 날짜 문자열 → epoch ms
 * EXIF 시각에는 보통 시간대가 없으므로 OffsetTimeOriginal 이 없으면 fallbackOffsetMin(기기 시간대)을 사용.
 * @param {string|null} raw 예: "2026:10:11 10:42:05"
 * @param {string|null} offset 예: "+09:00"
 * @param {number} fallbackOffsetMin UTC 기준 분 단위 오프셋 (KST = 540)
 * @returns {number|null}
 */
export function parseExifDate(raw, offset, fallbackOffsetMin) {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(utc)) return null;
  const om = typeof offset === 'string' ? offset.trim().match(/^([+-])(\d{2}):?(\d{2})$/) : null;
  const offsetMin = om ? (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3])) : fallbackOffsetMin;
  return utc - offsetMin * 60_000;
}

/** 가장 가까운 경로 지점 */
export function nearestPointIndex(points, lat, lon) {
  let best = -1;
  let bestDist = Infinity;
  points.forEach((p, i) => {
    const d = haversine(p, { lat, lon });
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return { index: best, distance: bestDist };
}

/** 시각이 가장 가까운 지점 (points 는 시간순 정렬 가정, 이진 탐색) */
export function indexAtTime(points, time) {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].time - time) <= Math.abs(points[lo].time - time)) return lo - 1;
  return lo;
}

/**
 * @param {{ lat: number|null, lon: number|null, time: number|null }} photo
 * @param {import('./geo.js').TrackPoint[]} points
 * @returns {{ ok: true, index: number, method: 'gps'|'time', offRoute?: number } | { ok: false, reason: string }}
 */
export function matchPhoto(photo, points) {
  if (points.length === 0) return { ok: false, reason: '경로가 없습니다.' };
  const hasGps = Number.isFinite(photo.lat) && Number.isFinite(photo.lon);
  if (hasGps) {
    const { index, distance } = nearestPointIndex(points, photo.lat, photo.lon);
    if (distance <= MAX_GPS_DISTANCE_M) return { ok: true, index, method: 'gps', offRoute: distance };
  }
  const timed = points.filter((p) => p.time != null);
  if (Number.isFinite(photo.time) && timed.length === points.length) {
    const start = points[0].time;
    const end = points.at(-1).time;
    if (photo.time >= start - TIME_TOLERANCE_MS && photo.time <= end + TIME_TOLERANCE_MS) {
      return { ok: true, index: indexAtTime(points, photo.time), method: 'time' };
    }
    return { ok: false, reason: hasGps ? '촬영 위치가 경로에서 멀고, 촬영 시각도 활동 시간 밖입니다.' : '촬영 시각이 활동 시간 밖입니다.' };
  }
  if (hasGps) return { ok: false, reason: '촬영 위치가 경로에서 1km 이상 떨어져 있습니다.' };
  return { ok: false, reason: '사진에 위치·촬영 시각 정보(EXIF)가 없습니다.' };
}

/**
 * 기록 중 촬영한 사진을 완성된 경로에 배치. 사진 시점의 GPS 가 있으므로 실패 없이 항상 위치를 정함:
 * 위치·시각 매칭 → 시각이 범위 밖이면 가장 가까운 시각 지점 → 그것도 없으면 마지막 지점
 * @returns {{ index: number, method: 'gps'|'time' }}
 */
export function placeLivePhoto(photo, points) {
  const match = matchPhoto(photo, points);
  if (match.ok) return { index: match.index, method: match.method };
  if (Number.isFinite(photo.time) && points.length > 0 && points.every((p) => p.time != null)) {
    return { index: indexAtTime(points, photo.time), method: 'time' };
  }
  return { index: Math.max(0, points.length - 1), method: 'time' };
}

// activity.js 의 SAFE_ID 와 같은 규칙 (photo-match 는 다른 모듈에 의존하지 않도록 따로 둠)
const SAFE_ID = /^[A-Za-z0-9_:-]{1,64}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v) => v === null || isNum(v);

/** 백업 복원 시 사진 레코드 검증 (blob/thumb 는 data URL 문자열) */
export function isValidPhotoRecord(p) {
  return (
    p != null &&
    typeof p === 'object' &&
    typeof p.id === 'string' &&
    SAFE_ID.test(p.id) &&
    typeof p.activityId === 'string' &&
    SAFE_ID.test(p.activityId) &&
    Number.isInteger(p.index) &&
    p.index >= 0 &&
    ['gps', 'time', 'manual'].includes(p.method) &&
    isNumOrNull(p.lat) &&
    isNumOrNull(p.lon) &&
    isNumOrNull(p.time) &&
    typeof p.blob === 'string' &&
    typeof p.thumb === 'string'
  );
}
