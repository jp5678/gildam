// IndexedDB 저장소 (Repository 패턴). 모든 데이터는 기기 안에만 저장됨.
import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8.0.0/+esm';

const DB_NAME = 'gildam';
const DB_VERSION = 2;
const ACTIVITIES = 'activities';
const DRAFTS = 'drafts';
const PHOTOS = 'photos';
const DRAFT_KEY = 'current';

let dbPromise = null;

function db() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore(ACTIVITIES, { keyPath: 'id' });
        store.createIndex('startTime', 'startTime');
        store.createIndex('type', 'type');
        database.createObjectStore(DRAFTS);
      }
      if (oldVersion < 2) {
        // 사진: { id, activityId, blob, thumb, lat, lon, time, index, method, name, createdAt }
        database.createObjectStore(PHOTOS, { keyPath: 'id' }).createIndex('activityId', 'activityId');
      }
    },
    // 새 버전 탭이 업그레이드를 요청하면 이 탭의 연결을 닫아 막지 않음 (다음 접근 때 다시 열림)
    blocking() {
      dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}

export function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 최신순 전체 활동 */
export async function findAllActivities() {
  const all = await (await db()).getAllFromIndex(ACTIVITIES, 'startTime');
  return all.reverse();
}

export async function findActivity(id) {
  return (await (await db()).get(ACTIVITIES, id)) ?? null;
}

export async function saveActivity(activity) {
  await (await db()).put(ACTIVITIES, activity);
  return activity;
}

/** 활동과 연결된 사진까지 함께 삭제 */
export async function deleteActivity(id) {
  const tx = (await db()).transaction([ACTIVITIES, PHOTOS], 'readwrite');
  const photoKeys = await tx.objectStore(PHOTOS).index('activityId').getAllKeys(id);
  await Promise.all([tx.objectStore(ACTIVITIES).delete(id), ...photoKeys.map((k) => tx.objectStore(PHOTOS).delete(k)), tx.done]);
}

// ---- 사진 ----

/** 경로 순서(index)대로 정렬된 활동 사진 */
export async function findPhotos(activityId) {
  const photos = await (await db()).getAllFromIndex(PHOTOS, 'activityId', activityId);
  return photos.sort((a, b) => a.index - b.index || (a.time ?? 0) - (b.time ?? 0));
}

export async function savePhoto(photo) {
  await (await db()).put(PHOTOS, photo);
  return photo;
}

export async function deletePhoto(id) {
  await (await db()).delete(PHOTOS, id);
}

// ---- 기록 중 임시 저장 (탭이 닫혀도 복구 가능) ----

export async function saveDraft(draft) {
  await (await db()).put(DRAFTS, draft, DRAFT_KEY);
}

export async function loadDraft() {
  return (await (await db()).get(DRAFTS, DRAFT_KEY)) ?? null;
}

export async function clearDraft() {
  await (await db()).delete(DRAFTS, DRAFT_KEY);
}

// ---- 백업 / 복원 ----

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  if (typeof url !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(url)) throw new Error('잘못된 이미지 데이터');
  return (await fetch(url)).blob();
}

/** 전체 백업용 덤프 (사진은 data URL 로 포함) */
export async function exportAll() {
  const activities = await findAllActivities();
  const rawPhotos = await (await db()).getAll(PHOTOS);
  const photos = await Promise.all(
    rawPhotos.map(async ({ blob, thumb, ...rest }) => ({ ...rest, blob: await blobToDataUrl(blob), thumb: await blobToDataUrl(thumb) })),
  );
  return { app: 'gildam', version: 2, exportedAt: new Date().toISOString(), activities, photos };
}

/**
 * 백업 복원: 같은 id 는 덮어씀
 * @param {object} backup
 * @param {(a: unknown) => boolean} validateActivity
 * @param {(p: unknown) => boolean} validatePhoto
 */
export async function importAll(backup, validateActivity, validatePhoto = () => false) {
  if (!backup || backup.app !== 'gildam' || !Array.isArray(backup.activities)) {
    throw new Error('길담 백업 파일이 아닙니다.');
  }
  const activities = backup.activities.filter(validateActivity);
  const activityIds = new Set(activities.map((a) => a.id));
  const rawPhotos = Array.isArray(backup.photos) ? backup.photos : [];
  // 트랜잭션 안에서 await(fetch)를 하면 트랜잭션이 닫히므로 Blob 변환을 먼저 끝냄
  const photos = (
    await Promise.all(
      rawPhotos
        .filter((p) => validatePhoto(p) && activityIds.has(p.activityId))
        .map(async (p) => {
          try {
            return { ...p, blob: await dataUrlToBlob(p.blob), thumb: await dataUrlToBlob(p.thumb) };
          } catch {
            return null;
          }
        }),
    )
  ).filter(Boolean);
  const tx = (await db()).transaction([ACTIVITIES, PHOTOS], 'readwrite');
  await Promise.all([
    ...activities.map((a) => tx.objectStore(ACTIVITIES).put(a)),
    ...photos.map((p) => tx.objectStore(PHOTOS).put(p)),
    tx.done,
  ]);
  return {
    imported: activities.length,
    skipped: backup.activities.length - activities.length,
    photos: photos.length,
    photosSkipped: rawPhotos.length - photos.length,
  };
}
