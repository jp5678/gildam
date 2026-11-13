// GPX / TCX 가져오기·내보내기.
// 파싱은 XML Document(브라우저 DOMParser 결과)를 받아 처리하고, 직렬화는 순수 문자열 생성.

import { normalizeType } from './activity-types.js';

export class TrackParseError extends Error {}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * 파일 내용을 판별해 파싱
 * @param {string} text XML 문자열
 * @param {(xml: string) => Document} parseXml 예: (s) => new DOMParser().parseFromString(s, 'application/xml')
 * @returns {{ name: string|null, type: string|null, points: import('./geo.js').TrackPoint[], format: 'gpx'|'tcx' }}
 */
export function parseTrackFile(text, parseXml) {
  if (typeof text !== 'string' || text.length === 0) throw new TrackParseError('빈 파일입니다.');
  if (text.length > MAX_FILE_BYTES) throw new TrackParseError('파일이 너무 큽니다 (최대 50MB).');
  const doc = parseXml(text);
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new TrackParseError('XML 형식이 올바르지 않습니다.');
  }
  const root = doc.documentElement?.localName;
  const result = root === 'TrainingCenterDatabase' ? parseTcx(doc) : root === 'gpx' ? parseGpx(doc) : null;
  if (!result) throw new TrackParseError('GPX 또는 TCX 파일이 아닙니다.');
  if (result.points.length < 2) throw new TrackParseError('경로 지점이 2개 미만입니다.');
  return result;
}

// 네임스페이스와 무관하게 localName 으로 하위 요소 찾기
function children(el, name) {
  return Array.from(el.getElementsByTagNameNS('*', name));
}

function firstText(el, name) {
  const found = el.getElementsByTagNameNS('*', name)[0];
  return found ? found.textContent.trim() : null;
}

function toNumber(s) {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toTime(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function validCoord(lat, lon) {
  return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function parseGpx(doc) {
  const tracks = children(doc, 'trk');
  const segments = tracks.length > 0 ? tracks.flatMap((t) => children(t, 'trkseg')) : children(doc, 'rte');
  const pointTag = tracks.length > 0 ? 'trkpt' : 'rtept';
  const points = segments.flatMap((segEl, seg) =>
    children(segEl, pointTag)
      .map((el) => ({
        lat: toNumber(el.getAttribute('lat')),
        lon: toNumber(el.getAttribute('lon')),
        ele: toNumber(firstText(el, 'ele')),
        time: toTime(firstText(el, 'time')),
        seg,
      }))
      .filter((p) => validCoord(p.lat, p.lon)),
  );
  const owner = tracks[0] ?? children(doc, 'rte')[0];
  const meta = children(doc, 'metadata')[0];
  return {
    name: (owner && firstText(owner, 'name')) || (meta && firstText(meta, 'name')) || null,
    type: normalizeType(owner && firstText(owner, 'type')),
    points,
    format: 'gpx',
  };
}

function parseTcx(doc) {
  const activity = children(doc, 'Activity')[0];
  if (!activity) return { name: null, type: null, points: [], format: 'tcx' };
  const points = children(activity, 'Track').flatMap((trackEl, seg) =>
    children(trackEl, 'Trackpoint')
      .map((tp) => {
        const pos = children(tp, 'Position')[0];
        return {
          lat: pos ? toNumber(firstText(pos, 'LatitudeDegrees')) : null,
          lon: pos ? toNumber(firstText(pos, 'LongitudeDegrees')) : null,
          ele: toNumber(firstText(tp, 'AltitudeMeters')),
          time: toTime(firstText(tp, 'Time')),
          seg,
        };
      })
      .filter((p) => validCoord(p.lat, p.lon)),
  );
  return {
    name: firstText(activity, 'Notes') || null,
    type: normalizeType(activity.getAttribute('Sport')),
    points,
    format: 'tcx',
  };
}

export function escapeXml(s) {
  return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

/**
 * 활동을 GPX 1.1 문자열로 직렬화 (일시정지 구간은 trkseg 로 분리)
 * @param {{ name: string, type: string, points: import('./geo.js').TrackPoint[] }} activity
 */
export function toGpx({ name, type, points }) {
  // 함수 내부에서 새로 만든 Map 만 채우므로 입력은 변경되지 않음
  const bySeg = new Map();
  for (const p of points) {
    if (!bySeg.has(p.seg)) bySeg.set(p.seg, []);
    bySeg.get(p.seg).push(p);
  }
  const segXml = [...bySeg.values()]
    .map((pts) => `    <trkseg>\n${pts.map(trkpt).join('\n')}\n    </trkseg>`)
    .join('\n');
  const firstTime = points.find((p) => p.time != null)?.time;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Gildam" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${escapeXml(name)}</name>${firstTime != null ? `<time>${new Date(firstTime).toISOString()}</time>` : ''}</metadata>`,
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
    `    <type>${escapeXml(type)}</type>`,
    segXml,
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

function trkpt(p) {
  const ele = Number.isFinite(p.ele) ? `<ele>${p.ele.toFixed(1)}</ele>` : '';
  const time = p.time != null ? `<time>${new Date(p.time).toISOString()}</time>` : '';
  return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${ele}${time}</trkpt>`;
}
