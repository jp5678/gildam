// 샘플 날짜 옮기기 (순수 함수): 샘플을 불러올 때 시각·경로는 그대로 두고 날짜만 최근 며칠 안으로 이동

const DAY_MS = 86_400_000;

function startOfLocalDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 첫 지점 날짜를 오늘로부터 daysAgo 일 전으로 옮기는 이동량(ms). 시각(시:분:초)은 유지.
 * 이동한 결과가 미래가 되면(자정을 넘는 활동 등) 하루씩 더 앞당김.
 * @param {number} firstTime 원본 첫 지점 시각
 * @param {number} lastTime 원본 마지막 지점 시각
 * @param {number} daysAgo 1 이상 권장
 * @param {number} now
 */
export function recentShiftMs(firstTime, lastTime, daysAgo, now) {
  const src = startOfLocalDay(firstTime);
  for (let back = Math.max(0, daysAgo); back < daysAgo + 7; back += 1) {
    const dst = startOfLocalDay(now);
    dst.setDate(dst.getDate() - back);
    // 날짜 차이만큼 이동 (setDate 로 계산해 일광절약시간에도 시각 유지)
    const shift = dst.getTime() - src.getTime();
    if (lastTime + shift <= now) return shift;
  }
  return startOfLocalDay(now).getTime() - DAY_MS * (daysAgo + 7) - src.getTime();
}

/** 모든 지점 시각을 shiftMs 만큼 이동한 새 배열 */
export function shiftPoints(points, shiftMs) {
  return points.map((p) => (p.time == null ? p : { ...p, time: p.time + shiftMs }));
}
