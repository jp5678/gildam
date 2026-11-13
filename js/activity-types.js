// 활동 종류별 상수: 이름, 색상, MET(칼로리 추정), GPS 튐 판단용 최대 속도(m/s)
export const ACTIVITY_TYPES = Object.freeze({
  walk: Object.freeze({ id: 'walk', label: '걷기', icon: '🚶', color: '#2e9e5b', met: 3.5, maxSpeed: 4 }),
  run: Object.freeze({ id: 'run', label: '달리기', icon: '🏃', color: '#e8603c', met: 9.8, maxSpeed: 9 }),
  bike: Object.freeze({ id: 'bike', label: '자전거', icon: '🚴', color: '#2f7fd8', met: 7.5, maxSpeed: 30 }),
  hike: Object.freeze({ id: 'hike', label: '등산', icon: '⛰️', color: '#9a6b2f', met: 6.0, maxSpeed: 4 }),
});

export const TYPE_IDS = Object.freeze(Object.keys(ACTIVITY_TYPES));

export function getType(id) {
  return ACTIVITY_TYPES[id] ?? ACTIVITY_TYPES.walk;
}

// GPX/TCX 의 type/sport 문자열 → 내부 종류
export function normalizeType(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (/run|러닝|달리/.test(s)) return 'run';
  if (/bik|cycl|ride|자전거/.test(s)) return 'bike';
  if (/hik|mountain|trek|등산/.test(s)) return 'hike';
  if (/walk|걷/.test(s)) return 'walk';
  return null;
}

// 종류 정보가 없을 때 평균 속도·상승고도로 추정
export function guessType({ avgSpeed, elevationGain, distance }) {
  if (avgSpeed > 4.5) return 'bike';
  if (distance > 0 && elevationGain / (distance / 1000) > 40) return 'hike';
  if (avgSpeed > 2.2) return 'run';
  return 'walk';
}
