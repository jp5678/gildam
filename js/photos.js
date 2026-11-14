// 사진 업로드: EXIF 읽기 → 경로 매칭 → 축소 저장. canvas 재인코딩으로 원본 EXIF(위치 등)는 저장본에서 제거됨.
import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';
import { matchPhoto, parseExifDate, placeLivePhoto } from './photo-match.js';
import { savePhoto, newId, findPhotos, deletePhoto } from './db.js';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 30;
const FULL_MAX_PX = 1600;
const THUMB_MAX_PX = 240;
const JPEG_QUALITY = 0.85;
const DECODE_TIMEOUT_MS = 15_000;

export class PhotoError extends Error {}

/** 기록 중 촬영한 사진을 활동이 저장될 때까지 묶어 두는 임시 활동 id */
export const DRAFT_ACTIVITY_ID = 'draft:current';

/** EXIF 에서 위치·촬영 시각 읽기 (없으면 null) */
export async function readPhotoMeta(file) {
  const [gps, tags] = await Promise.all([
    exifr.gps(file).catch(() => null),
    exifr
      .parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime'], reviveValues: false })
      .catch(() => null),
  ]);
  // 기기 시간대 (분). getTimezoneOffset 은 부호가 반대
  const localOffset = -new Date().getTimezoneOffset();
  const time = parseExifDate(tags?.DateTimeOriginal ?? tags?.CreateDate ?? null, tags?.OffsetTimeOriginal ?? tags?.OffsetTime ?? null, localOffset);
  return {
    lat: Number.isFinite(gps?.latitude) ? gps.latitude : null,
    lon: Number.isFinite(gps?.longitude) ? gps.longitude : null,
    time,
  };
}

/** <img> 로 디코딩 (createImageBitmap 옵션을 지원하지 않는 이전 Safari 등). 최신 브라우저는 EXIF 회전을 반영함 */
async function decodeWithImage(file) {
  const url = URL.createObjectURL(file);
  try {
    // img.decode() 는 화면이 그려지지 않는 상태에서 끝나지 않는 경우가 있어 onload + 시간 제한 사용
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      const timer = setTimeout(() => reject(new Error('timeout')), DECODE_TIMEOUT_MS);
      el.onload = () => (clearTimeout(timer), resolve(el));
      el.onerror = () => (clearTimeout(timer), reject(new Error('decode failed')));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 이미지 디코딩: createImageBitmap(회전 반영) → 옵션 없이 → <img> 순으로 시도 */
async function decode(file) {
  const attempts = [
    () => createImageBitmap(file, { imageOrientation: 'from-image' }),
    () => createImageBitmap(file),
  ];
  for (const attempt of attempts) {
    try {
      const bitmap = await attempt();
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // 다음 방법으로 시도
    }
  }
  try {
    return await decodeWithImage(file);
  } catch {
    throw new PhotoError('이 이미지 형식(HEIC 등)은 브라우저에서 열 수 없습니다. JPEG 로 변환해 올려 주세요.');
  }
}

function resize(image, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image.source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('이미지를 변환하지 못했습니다.'))), 'image/jpeg', JPEG_QUALITY),
  );
}

function validateImageFile(file) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new PhotoError('이미지 파일이 아닙니다.');
  if (file.size > MAX_FILE_BYTES) throw new PhotoError('파일이 너무 큽니다 (최대 40MB).');
}

/** 축소·재인코딩 후 저장 (원본 EXIF 제거) */
async function storeImage(file, fields) {
  const image = await decode(file);
  try {
    const [blob, thumb] = await Promise.all([resize(image, FULL_MAX_PX), resize(image, THUMB_MAX_PX)]);
    return savePhoto({ id: newId(), blob, thumb, name: file.name.slice(0, 120), createdAt: Date.now(), ...fields });
  } finally {
    image.close();
  }
}

async function processOne(file, activity, force) {
  validateImageFile(file);
  const raw = await readPhotoMeta(file);
  // 날짜를 옮긴 샘플 활동이면 사진 촬영 시각도 같은 만큼 옮겨 비교 (저장값도 옮긴 시각)
  const shift = Number.isFinite(activity.sampleShiftMs) ? activity.sampleShiftMs : 0;
  const meta = shift && raw.time != null ? { ...raw, time: raw.time + shift } : raw;
  const match = matchPhoto(meta, activity.points);
  if (match.ok) {
    return storeImage(file, { activityId: activity.id, lat: meta.lat, lon: meta.lon, time: meta.time, index: match.index, method: match.method });
  }
  if (!force) throw new PhotoError(match.reason);
  // 사용자가 확인한 경우: 가장 가까운 시각 지점(시각이 없으면 도착 지점)에 '직접 지정'으로 배치
  const { index } = placeLivePhoto(meta, activity.points);
  return storeImage(file, { activityId: activity.id, lat: meta.lat, lon: meta.lon, time: meta.time, index, method: 'manual' });
}

/**
 * 기록 중 촬영: 카메라 사진은 브라우저가 위치 EXIF 를 지우는 경우가 많아 촬영 순간의 GPS 위치를 사용
 * @param {File} file
 * @param {{ lat: number|null, lon: number|null, time: number }} where
 */
export async function addLivePhoto(file, where) {
  validateImageFile(file);
  return storeImage(file, {
    activityId: DRAFT_ACTIVITY_ID,
    lat: Number.isFinite(where.lat) ? where.lat : null,
    lon: Number.isFinite(where.lon) ? where.lon : null,
    time: where.time,
    index: 0,
    method: Number.isFinite(where.lat) ? 'gps' : 'time',
  });
}

export async function countDraftPhotos() {
  return (await findPhotos(DRAFT_ACTIVITY_ID)).length;
}

/** 기록이 저장되면 임시 사진을 경로에 배치해 활동에 연결. 연결한 장수 반환 */
export async function attachDraftPhotos(activity) {
  const drafts = await findPhotos(DRAFT_ACTIVITY_ID);
  await Promise.all(
    drafts.map((p) => {
      const { index, method } = placeLivePhoto(p, activity.points);
      return savePhoto({ ...p, activityId: activity.id, index, method });
    }),
  );
  return drafts.length;
}

/** 기록을 버리면 임시 사진도 삭제 */
export async function discardDraftPhotos() {
  const drafts = await findPhotos(DRAFT_ACTIVITY_ID);
  await Promise.all(drafts.map((p) => deletePhoto(p.id)));
  return drafts.length;
}

/**
 * 여러 사진 추가 (메모리 절약을 위해 순차 처리)
 * @returns {Promise<{ saved: object[], failed: { name: string, reason: string }[] }>}
 */
export async function addPhotos(activity, files, onProgress = () => {}, { force = false } = {}) {
  const list = Array.from(files);
  if (list.length > MAX_FILES_PER_UPLOAD) {
    return { saved: [], failed: [{ name: `${list.length}장`, reason: `한 번에 최대 ${MAX_FILES_PER_UPLOAD}장까지 올릴 수 있습니다.` }] };
  }
  const saved = [];
  const failed = [];
  for (const [i, file] of list.entries()) {
    onProgress(i + 1, list.length);
    try {
      saved.push(await processOne(file, activity, force));
    } catch (err) {
      // placeable: 위치만 못 찾은 경우(직접 지정으로 다시 추가 가능). 형식·용량 오류는 제외
      const placeable = err instanceof PhotoError && !/이미지|형식|너무 큽/.test(err.message);
      failed.push({ name: file.name, file, placeable, reason: err instanceof PhotoError ? err.message : `처리 실패 (${err?.message ?? err})` });
    }
  }
  return { saved, failed };
}

/** 사진 Blob → object URL 묶음. 화면을 떠날 때 revoke() 호출 */
export function createPhotoUrls(photos) {
  const urls = new Map(photos.map((p) => [p.id, { full: URL.createObjectURL(p.blob), thumb: URL.createObjectURL(p.thumb) }]));
  return {
    get: (id) => urls.get(id),
    revoke: () => urls.forEach(({ full, thumb }) => (URL.revokeObjectURL(full), URL.revokeObjectURL(thumb))),
  };
}
