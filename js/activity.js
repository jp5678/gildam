// 활동 객체 생성·검증 (순수 함수)
import { computeStats, filterPoints } from './geo.js';
import { getType, guessType, TYPE_IDS } from './activity-types.js';
import { defaultActivityName } from './format.js';

/**
 * @typedef {object} Activity
 * @property {string} id
 * @property {'walk'|'run'|'bike'|'hike'|'car'} type
 * @property {string} name
 * @property {'gps'|'gpx'|'tcx'} source
 * @property {number} startTime
 * @property {number} endTime
 * @property {import('./geo.js').TrackPoint[]} points
 * @property {ReturnType<typeof computeStats>} stats
 * @property {number} createdAt
 * @property {number} [filteredCount]
 */

/**
 * @param {{ id: string, now: number, points: import('./geo.js').TrackPoint[], type?: string|null,
 *   name?: string|null, source: 'gps'|'gpx'|'tcx', weightKg: number, applySpeedFilter?: boolean }} input
 * @returns {Activity}
 */
export function buildActivity({ id, now, points, type, name, source, weightKg, applySpeedFilter = false }) {
  const cleanPoints = points.map(({ lat, lon, ele, time, seg }) => ({ lat, lon, ele: ele ?? null, time: time ?? null, seg: seg ?? 0 }));
  // 가져온 파일은 종류를 먼저 추정해야 속도 필터 기준을 정할 수 있음
  const provisional = computeStats(cleanPoints, { met: 0, weightKg });
  const resolvedType = TYPE_IDS.includes(type) ? type : guessType(provisional);
  const { points: kept, dropped } = applySpeedFilter
    ? filterPoints(cleanPoints, { maxSpeed: getType(resolvedType).maxSpeed })
    : { points: cleanPoints, dropped: 0 };
  const times = kept.map((p) => p.time).filter((t) => t != null);
  const startTime = times[0] ?? now;
  const typeInfo = getType(resolvedType);
  return {
    id,
    type: resolvedType,
    name: (name ?? '').trim().slice(0, 80) || defaultActivityName(startTime, typeInfo.label),
    source,
    startTime,
    endTime: times.at(-1) ?? startTime,
    points: kept,
    stats: computeStats(kept, { met: typeInfo.met, weightKg }),
    createdAt: now,
    filteredCount: dropped,
  };
}

/** 종류·이름 변경 시 통계(칼로리)를 다시 계산한 새 객체 */
export function updateActivity(activity, { type, name }, weightKg) {
  const nextType = TYPE_IDS.includes(type) ? type : activity.type;
  const nextName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : activity.name;
  return {
    ...activity,
    type: nextType,
    name: nextName,
    stats: computeStats(activity.points, { met: getType(nextType).met, weightKg }),
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v) => v == null || isNum(v);

/** 저장소 id 로 허용하는 형식 (HTML 속성·URL 에 그대로 써도 안전한 문자만) */
export const SAFE_ID = /^[A-Za-z0-9_:-]{1,64}$/;

function isValidPoint(p) {
  return (
    p != null &&
    isNum(p.lat) &&
    isNum(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180 &&
    isNumOrNull(p.ele) &&
    isNumOrNull(p.time) &&
    (p.seg == null || Number.isInteger(p.seg))
  );
}

/** 백업 복원 시 외부 데이터 검증 */
export function isValidActivity(a) {
  return (
    a != null &&
    typeof a === 'object' &&
    typeof a.id === 'string' &&
    SAFE_ID.test(a.id) &&
    TYPE_IDS.includes(a.type) &&
    typeof a.name === 'string' &&
    isNum(a.startTime) &&
    Array.isArray(a.points) &&
    a.points.length >= 2 &&
    a.points.every(isValidPoint) &&
    a.stats != null &&
    typeof a.stats === 'object'
  );
}
