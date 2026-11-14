// 활동 종류별 상수
// met: 칼로리 추정용 (0 이면 칼로리 미표시), maxSpeed: GPS 튐 판단 최대 속도(m/s)
// speedBased: 페이스 대신 속도로 표시, exercise: 통계 '전체'·개인 기록에 포함 여부
export const ACTIVITY_TYPES = Object.freeze({
  walk: Object.freeze({ id: 'walk', label: '걷기', icon: '🚶', color: '#2e9e5b', met: 3.5, maxSpeed: 4, speedBased: false, exercise: true }),
  run: Object.freeze({ id: 'run', label: '달리기', icon: '🏃', color: '#e8603c', met: 9.8, maxSpeed: 9, speedBased: false, exercise: true }),
  bike: Object.freeze({ id: 'bike', label: '자전거', icon: '🚴', color: '#2f7fd8', met: 7.5, maxSpeed: 30, speedBased: true, exercise: true }),
  hike: Object.freeze({ id: 'hike', label: '등산', icon: '⛰️', color: '#9a6b2f', met: 6.0, maxSpeed: 4, speedBased: false, exercise: true }),
  car: Object.freeze({ id: 'car', label: '자동차', icon: '🚗', color: '#7a5cd6', met: 0, maxSpeed: 70, speedBased: true, exercise: false }),
});

export const TYPE_IDS = Object.freeze(Object.keys(ACTIVITY_TYPES));

export function getType(id) {
  return ACTIVITY_TYPES[id] ?? ACTIVITY_TYPES.walk;
}

/** 페이스 대신 속도로 표시하는 종류인지 (자전거·자동차) */
export const usesSpeed = (id) => getType(id).speedBased;

// GPX/TCX 의 type/sport 문자열 → 내부 종류
export function normalizeType(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (/\bcar\b|driv|automotive|motor|자동차|운전|드라이브/.test(s)) return 'car';
  if (/run|러닝|달리/.test(s)) return 'run';
  if (/bik|cycl|ride|자전거/.test(s)) return 'bike';
  if (/hik|mountain|trek|등산/.test(s)) return 'hike';
  if (/walk|걷/.test(s)) return 'walk';
  return null;
}

// 종류 정보가 없을 때 평균 속도·상승고도로 추정
export function guessType({ avgSpeed, elevationGain, distance }) {
  if (avgSpeed > 10) return 'car'; // 이동 평균 36km/h 초과
  if (avgSpeed > 4.5) return 'bike';
  if (distance > 0 && elevationGain / (distance / 1000) > 40) return 'hike';
  if (avgSpeed > 2.2) return 'run';
  return 'walk';
}
