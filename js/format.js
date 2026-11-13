// 한국어 표시용 포맷터

const pad = (n) => String(Math.floor(n)).padStart(2, '0');

/** 미터 → "5.23 km" 또는 "850 m" */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '-';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** 초 → "1:05:09" 또는 "5:09" */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** s/km → "5'32\"/km" */
export function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '-';
  const rounded = Math.round(secPerKm);
  return `${Math.floor(rounded / 60)}'${pad(rounded % 60)}"`;
}

/** m/s → "12.3 km/h" */
export function formatSpeed(ms) {
  if (!Number.isFinite(ms)) return '-';
  return `${(ms * 3.6).toFixed(1)} km/h`;
}

export function formatElevation(m) {
  return Number.isFinite(m) ? `${Math.round(m)} m` : '-';
}

export function formatCalories(kcal) {
  return Number.isFinite(kcal) ? `${Math.round(kcal).toLocaleString('ko-KR')} kcal` : '-';
}

const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(ms) {
  return Number.isFinite(ms) ? dateFmt.format(new Date(ms)) : '-';
}

/** 시간대 기반 기본 활동 이름: "토요일 아침 등산" */
export function defaultActivityName(ms, typeLabel) {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat('ko-KR', { weekday: 'long' }).format(d);
  const h = d.getHours();
  const part = h < 5 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심' : h < 18 ? '오후' : h < 22 ? '저녁' : '밤';
  return `${day} ${part} ${typeLabel}`;
}

/** HTML 이스케이프 (innerHTML 에 사용자 입력·파일 내용을 넣을 때 필수) */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
