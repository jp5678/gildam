// 메모 레코드 규칙 (순수 함수): 텍스트 정리, 백업 검증, 경로 위치 계산
// 메모: { id, activityId, text, lat, lon, time, index, method: 'gps'|'time'|'manual', createdAt, updatedAt? }

export const MAX_NOTE_LENGTH = 500;

// activity.js 의 SAFE_ID 와 같은 규칙 (다른 모듈에 의존하지 않도록 따로 둠)
const SAFE_ID = /^[A-Za-z0-9_:-]{1,64}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v) => v === null || isNum(v);

/** 앞뒤 공백 제거, 연속 빈 줄은 하나로, 최대 길이 제한. 내용이 없으면 '' */
export function cleanNoteText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTE_LENGTH);
}

/** 목록·마커용 한 줄 요약 */
export function noteSnippet(text, max = 30) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** 누적 거리 배열에서 meters 에 가장 가까운 지점 index */
export function nearestIndexAtDistance(cum, meters) {
  if (cum.length === 0) return 0;
  let best = 0;
  cum.forEach((d, i) => {
    if (Math.abs(d - meters) < Math.abs(cum[best] - meters)) best = i;
  });
  return best;
}

/** 백업 복원 시 메모 레코드 검증 */
export function isValidNoteRecord(n) {
  return (
    n != null &&
    typeof n === 'object' &&
    typeof n.id === 'string' &&
    SAFE_ID.test(n.id) &&
    typeof n.activityId === 'string' &&
    SAFE_ID.test(n.activityId) &&
    typeof n.text === 'string' &&
    n.text.trim().length > 0 &&
    n.text.length <= MAX_NOTE_LENGTH &&
    Number.isInteger(n.index) &&
    n.index >= 0 &&
    ['gps', 'time', 'manual'].includes(n.method) &&
    isNumOrNull(n.lat) &&
    isNumOrNull(n.lon) &&
    isNumOrNull(n.time)
  );
}
