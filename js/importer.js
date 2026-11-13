// GPX/TCX 파일 → 활동 저장 (기록 화면·보관함 공용)
import { parseTrackFile, TrackParseError } from './gpx.js';
import { buildActivity } from './activity.js';
import { saveActivity, newId } from './db.js';
import { loadSettings } from './settings-store.js';

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

/** 텍스트 하나를 활동으로 변환해 저장 */
export async function importTrackText(text, fileName = '') {
  const parsed = parseTrackFile(text, parseXml);
  const activity = buildActivity({
    id: newId(),
    now: Date.now(),
    points: parsed.points,
    type: parsed.type,
    name: parsed.name || fileName.replace(/\.(gpx|tcx)$/i, ''),
    source: parsed.format,
    weightKg: loadSettings().weightKg,
    applySpeedFilter: true,
  });
  return saveActivity(activity);
}

/**
 * 여러 파일 가져오기. 실패한 파일은 사유와 함께 반환.
 * @param {FileList|File[]} files
 * @returns {Promise<{ saved: object[], failed: { name: string, reason: string }[] }>}
 */
export async function importFiles(files) {
  const results = await Promise.all(
    Array.from(files).map(async (file) => {
      try {
        if (!/\.(gpx|tcx)$/i.test(file.name)) throw new TrackParseError('GPX 또는 TCX 파일만 가져올 수 있습니다.');
        return { ok: true, activity: await importTrackText(await file.text(), file.name) };
      } catch (err) {
        const reason = err instanceof TrackParseError ? err.message : `알 수 없는 오류 (${err?.message ?? err})`;
        return { ok: false, name: file.name, reason };
      }
    }),
  );
  return {
    saved: results.filter((r) => r.ok).map((r) => r.activity),
    failed: results.filter((r) => !r.ok).map(({ name, reason }) => ({ name, reason })),
  };
}

/** 앱에 포함된 샘플 GPX 불러오기 */
export async function importSample(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`샘플을 불러오지 못했습니다 (${res.status})`);
  return importTrackText(await res.text(), path.split('/').pop());
}
