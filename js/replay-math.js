// 리플레이 계산 (순수 함수): 진행률 → 위치·시간·방향
import { cumulativeDistances } from './geo.js';

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** a → b 방위각 (0=북, 시계방향, 도) */
export function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 각도를 최단 방향으로 t 만큼 보간 */
export function lerpAngle(from, to, t) {
  const diff = ((to - from + 540) % 360) - 180;
  return (from + diff * t + 360) % 360;
}

/** 리플레이 기본 길이(초): 1km 당 6초, 30~120초 */
export function baseDurationSec(distanceM) {
  return Math.min(120, Math.max(30, (distanceM / 1000) * 6));
}

/**
 * 경로 트랙을 진행률(0~1, 거리 기준)로 조회하는 객체 생성
 * @param {import('./geo.js').TrackPoint[]} points
 */
export function createTrack(points) {
  const cum = cumulativeDistances(points);
  const total = cum.at(-1) ?? 0;

  function locate(distance) {
    const d = Math.min(Math.max(distance, 0), total);
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const k = Math.max(1, lo);
    const span = cum[k] - cum[k - 1];
    const t = span > 0 ? (d - cum[k - 1]) / span : 0;
    return { k, t };
  }

  const lerp = (a, b, t) => (a == null || b == null ? (a ?? b) : a + (b - a) * t);

  /** 진행률 → { lat, lon, ele, time, distance, index } */
  function at(fraction) {
    if (points.length === 1) return { ...points[0], distance: 0, index: 0 };
    const distance = fraction * total;
    const { k, t } = locate(distance);
    const a = points[k - 1];
    const b = points[k];
    return {
      lat: lerp(a.lat, b.lat, t),
      lon: lerp(a.lon, b.lon, t),
      ele: lerp(a.ele, b.ele, t),
      time: lerp(a.time, b.time, t),
      distance: Math.min(distance, total),
      index: t < 0.5 ? k - 1 : k,
    };
  }

  /** 지점 인덱스 → 진행률 */
  function fractionOfIndex(i) {
    return total > 0 ? cum[Math.min(Math.max(i, 0), cum.length - 1)] / total : 0;
  }

  /** 현재 위치에서 lookAheadM 앞 지점을 향한 방위각 */
  function headingAt(fraction, lookAheadM) {
    const here = at(fraction);
    const aheadDist = Math.min(total, here.distance + lookAheadM);
    const ahead = at(total > 0 ? aheadDist / total : 0);
    if (aheadDist - here.distance < 1) {
      const behind = at(total > 0 ? Math.max(0, here.distance - lookAheadM) / total : 0);
      return bearing(behind, here);
    }
    return bearing(here, ahead);
  }

  return { total, at, fractionOfIndex, headingAt };
}
