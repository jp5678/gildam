// 상세 화면의 메모 섹션: 추가(경로 위치 선택), 목록, 수정, 삭제
import { findNotes, deleteNote } from '../db.js';
import { addNoteAt, updateNote } from '../notes.js';
import { formatDateTime, formatDistance, esc } from '../format.js';
import { cumulativeDistances } from '../geo.js';
import { toast, confirmDialog } from '../ui.js';
import { openNoteEditor } from './note-dialog.js';

const METHOD_LABEL = Object.freeze({ gps: '기록 중 위치', time: '기록 중 시각', manual: '직접 지정' });

/** "1.20 km 지점 · 11/13 18:42" */
export function noteCaption(note, points, cum = cumulativeDistances(points)) {
  const at = formatDistance(cum[Math.min(note.index, cum.length - 1)]);
  const when = note.time ? formatDateTime(note.time) : null;
  return [`${at} 지점`, when].filter(Boolean).join(' · ');
}

/**
 * @param {HTMLElement} el 섹션 컨테이너
 * @param {() => object} getActivity 현재 활동
 * @param {(notes: object[]) => void} onChange 메모 목록이 바뀌면 호출 (지도 마커 갱신용)
 * @returns {Promise<void>}
 */
export async function mountNoteSection(el, getActivity, onChange) {
  let notes = [];

  el.innerHTML = `
    <div class="section-head">
      <h2>메모</h2>
      <button class="btn btn-secondary btn-sm" data-action="add-note">📝 메모 추가</button>
    </div>
    <p class="hint">기록 중에는 기록 탭의 📝 버튼으로 그 자리에 바로 남길 수 있습니다. 여기서는 경로 위 위치를 골라 추가합니다.</p>
    <ol class="note-list" data-ref="list"></ol>`;
  const list = el.querySelector('[data-ref="list"]');

  function draw() {
    const { points } = getActivity();
    const cum = cumulativeDistances(points);
    list.innerHTML = notes.length
      ? notes
          .map(
            (n) => `<li class="note-item" data-note="${esc(n.id)}">
              <p class="note-meta">${esc(noteCaption(n, points, cum))} · ${esc(METHOD_LABEL[n.method] ?? '')}</p>
              <p class="note-text">${esc(n.text)}</p>
              <div class="note-actions">
                <button class="btn btn-ghost btn-sm" data-edit="${esc(n.id)}">수정</button>
                <button class="btn btn-danger-ghost btn-sm" data-del="${esc(n.id)}">삭제</button>
              </div>
            </li>`,
          )
          .join('')
      : '<p class="muted">아직 메모가 없습니다.</p>';
  }

  async function reload() {
    notes = await findNotes(getActivity().id);
    onChange(notes);
    draw();
  }

  async function add() {
    const activity = getActivity();
    const cum = cumulativeDistances(activity.points);
    const result = await openNoteEditor({ title: '📝 메모 추가', route: { cum, index: activity.points.length - 1 } });
    if (!result) return;
    await addNoteAt(activity, result.text, result.index);
    toast('메모를 추가했습니다.');
    await reload();
  }

  async function edit(note) {
    const activity = getActivity();
    const cum = cumulativeDistances(activity.points);
    const result = await openNoteEditor({ title: '📝 메모 수정', text: note.text, route: { cum, index: note.index } });
    if (!result) return;
    await updateNote(activity, note, result);
    await reload();
  }

  el.addEventListener('click', (e) => {
    const editId = e.target.closest('[data-edit]')?.dataset.edit;
    const delId = e.target.closest('[data-del]')?.dataset.del;
    const run = async () => {
      if (e.target.closest('[data-action="add-note"]')) return add();
      const note = notes.find((n) => n.id === (editId ?? delId));
      if (!note) return;
      if (editId) return edit(note);
      if (!(await confirmDialog('이 메모를 삭제할까요? 되돌릴 수 없습니다.'))) return;
      await deleteNote(note.id);
      await reload();
    };
    run().catch((err) => toast(err?.message ?? String(err), { type: 'error' }));
  });

  await reload();
}
