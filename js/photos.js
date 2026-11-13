// 사진 업로드: EXIF 읽기 → 경로 매칭 → 축소 저장. canvas 재인코딩으로 원본 EXIF(위치 등)는 저장본에서 제거됨.
import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';
import { matchPhoto, parseExifDate } from './photo-match.js';
import { savePhoto, newId } from './db.js';

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 30;
const FULL_MAX_PX = 1600;
const THUMB_MAX_PX = 240;
const JPEG_QUALITY = 0.85;

export class PhotoError extends Error {}

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

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('이 이미지 형식(HEIC 등)은 브라우저에서 열 수 없습니다. JPEG 로 변환해 올려 주세요.');
  }
}

function resize(bitmap, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('이미지를 변환하지 못했습니다.'))), 'image/jpeg', JPEG_QUALITY),
  );
}

async function processOne(file, activity) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new PhotoError('이미지 파일이 아닙니다.');
  if (file.size > MAX_FILE_BYTES) throw new PhotoError('파일이 너무 큽니다 (최대 40MB).');
  const meta = await readPhotoMeta(file);
  const match = matchPhoto(meta, activity.points);
  if (!match.ok) throw new PhotoError(match.reason);
  const bitmap = await decode(file);
  try {
    const [blob, thumb] = await Promise.all([resize(bitmap, FULL_MAX_PX), resize(bitmap, THUMB_MAX_PX)]);
    return savePhoto({
      id: newId(),
      activityId: activity.id,
      blob,
      thumb,
      lat: meta.lat,
      lon: meta.lon,
      time: meta.time,
      index: match.index,
      method: match.method,
      name: file.name.slice(0, 120),
      createdAt: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

/**
 * 여러 사진 추가 (메모리 절약을 위해 순차 처리)
 * @returns {Promise<{ saved: object[], failed: { name: string, reason: string }[] }>}
 */
export async function addPhotos(activity, files, onProgress = () => {}) {
  const list = Array.from(files);
  if (list.length > MAX_FILES_PER_UPLOAD) {
    return { saved: [], failed: [{ name: `${list.length}장`, reason: `한 번에 최대 ${MAX_FILES_PER_UPLOAD}장까지 올릴 수 있습니다.` }] };
  }
  const saved = [];
  const failed = [];
  for (const [i, file] of list.entries()) {
    onProgress(i + 1, list.length);
    try {
      saved.push(await processOne(file, activity));
    } catch (err) {
      failed.push({ name: file.name, reason: err instanceof PhotoError ? err.message : `처리 실패 (${err?.message ?? err})` });
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
