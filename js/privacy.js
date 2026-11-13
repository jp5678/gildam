// 집 주변 숨기기 (순수 함수): 공유 이미지·영상에서 집 반경 안의 시작/끝 경로를 잘라냄
import { haversine } from './geo.js';

/**
 * @param {import('./geo.js').TrackPoint[]} points
 * @param {{ enabled: boolean, lat: number|null, lon: number|null, radius: number }} home
 * @returns {{ points: import('./geo.js').TrackPoint[], start: number, end: number, trimmed: boolean, allHidden: boolean }}
 *   start/end 는 원본에서 남긴 구간의 인덱스 [start, end]
 */
export function hideHome(points, home) {
  const full = { points, start: 0, end: points.length - 1, trimmed: false, allHidden: false };
  if (!home?.enabled || !Number.isFinite(home.lat) || !Number.isFinite(home.lon) || points.length === 0) return full;
  const center = { lat: home.lat, lon: home.lon };
  const inside = (p) => haversine(p, center) <= home.radius;
  let start = 0;
  while (start < points.length && inside(points[start])) start += 1;
  if (start === points.length) return { points: [], start: 0, end: -1, trimmed: true, allHidden: true };
  let end = points.length - 1;
  while (end > start && inside(points[end])) end -= 1;
  const trimmed = start > 0 || end < points.length - 1;
  return { points: trimmed ? points.slice(start, end + 1) : points, start, end, trimmed, allHidden: false };
}

/** 사진 인덱스를 잘린 경로 기준으로 변환 (가려진 구간의 사진은 제외) */
export function remapPhotos(photos, start, end) {
  return photos.filter((p) => p.index >= start && p.index <= end).map((p) => ({ ...p, index: p.index - start }));
}

/** 집 주변 숨기기 상태 안내 문구 (공유 화면용) */
export function homeHideNotice(home) {
  if (!home?.enabled) return null;
  if (!Number.isFinite(home.lat)) return '집 주변 숨기기가 켜져 있지만 집 위치가 설정되지 않았습니다. 설정에서 위치를 지정해 주세요.';
  return `집 반경 ${home.radius}m 안의 시작·끝 경로는 가려집니다.`;
}
