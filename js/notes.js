// 메모 저장: 기록 중 메모(임시) → 기록 저장 시 경로에 배치, 상세 화면에서 추가·수정
import { findNotes, saveNote, deleteNote, newId } from './db.js';
import { placeLivePhoto } from './photo-match.js';
import { cleanNoteText } from './note-model.js';
import { DRAFT_ACTIVITY_ID } from './photos.js';

export class NoteError extends Error {}

function requireText(text) {
  const clean = cleanNoteText(text);
  if (!clean) throw new NoteError('메모 내용을 입력해 주세요.');
  return clean;
}

/**
 * 기록 중 메모: 그 순간의 GPS 위치·시각으로 임시 저장
 * @param {string} text
 * @param {{ lat: number|null, lon: number|null, time: number }} where
 */
export async function addLiveNote(text, where) {
  const hasFix = Number.isFinite(where.lat) && Number.isFinite(where.lon);
  return saveNote({
    id: newId(),
    activityId: DRAFT_ACTIVITY_ID,
    text: requireText(text),
    lat: hasFix ? where.lat : null,
    lon: hasFix ? where.lon : null,
    time: where.time,
    index: 0,
    method: hasFix ? 'gps' : 'time',
    createdAt: Date.now(),
  });
}

export async function countDraftNotes() {
  return (await findNotes(DRAFT_ACTIVITY_ID)).length;
}

/** 기록이 저장되면 임시 메모를 경로에 배치해 활동에 연결. 연결한 개수 반환 */
export async function attachDraftNotes(activity) {
  const drafts = await findNotes(DRAFT_ACTIVITY_ID);
  await Promise.all(
    drafts.map((n) => {
      const { index, method } = placeLivePhoto(n, activity.points);
      return saveNote({ ...n, activityId: activity.id, index, method });
    }),
  );
  return drafts.length;
}

/** 기록을 버리면 임시 메모도 삭제 */
export async function discardDraftNotes() {
  const drafts = await findNotes(DRAFT_ACTIVITY_ID);
  await Promise.all(drafts.map((n) => deleteNote(n.id)));
  return drafts.length;
}

/** 상세 화면에서 경로 위 지점(index)을 골라 메모 추가 */
export async function addNoteAt(activity, text, index) {
  const p = activity.points[index];
  if (!p) throw new NoteError('경로 위치가 올바르지 않습니다.');
  return saveNote({
    id: newId(),
    activityId: activity.id,
    text: requireText(text),
    lat: p.lat,
    lon: p.lon,
    time: p.time ?? null,
    index,
    method: 'manual',
    createdAt: Date.now(),
  });
}

/** 내용·위치 수정 (새 객체로 저장). 위치가 바뀌면 '직접 지정'으로 표시 */
export async function updateNote(activity, note, { text, index }) {
  const moved = index !== note.index;
  const p = activity.points[index];
  if (!p) throw new NoteError('경로 위치가 올바르지 않습니다.');
  return saveNote({
    ...note,
    text: requireText(text),
    index,
    ...(moved ? { lat: p.lat, lon: p.lon, time: p.time ?? null, method: 'manual' } : {}),
    updatedAt: Date.now(),
  });
}
