// 메모 입력·수정·보기 대화상자
import { MAX_NOTE_LENGTH, cleanNoteText } from '../note-model.js';
import { formatDistance } from '../format.js';

function makeDialog(className) {
  const dlg = document.createElement('dialog');
  dlg.className = `note-dialog ${className}`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  return dlg;
}

/**
 * 메모 입력창. route 를 주면 경로 위치 슬라이더도 표시.
 * @param {{ title: string, text?: string, route?: { cum: number[], index: number } }} opts
 * @returns {Promise<{ text: string, index: number|null } | null>} 취소하면 null
 */
export function openNoteEditor({ title, text = '', route = null }) {
  const dlg = makeDialog('note-editor');
  dlg.innerHTML = `<form method="dialog">
      <h3></h3>
      <textarea rows="5" maxlength="${MAX_NOTE_LENGTH}" placeholder="예: 여기 경치 좋음, 물 보충, 오르막 시작" aria-label="메모 내용"></textarea>
      <p class="note-count muted"></p>
      ${route ? `<label class="note-pos"><span>위치 <b></b></span><input type="range" min="0" max="${route.cum.length - 1}" step="1" aria-label="경로 위치"></label>` : ''}
      <div class="row">
        <button class="btn btn-ghost" value="cancel" formnovalidate>취소</button>
        <button class="btn btn-primary" value="save">저장</button>
      </div>
    </form>`;
  dlg.querySelector('h3').textContent = title;
  const area = dlg.querySelector('textarea');
  const count = dlg.querySelector('.note-count');
  const saveBtn = dlg.querySelector('[value="save"]');
  const slider = dlg.querySelector('input[type="range"]');
  area.value = text;

  const refresh = () => {
    count.textContent = `${area.value.length}/${MAX_NOTE_LENGTH}`;
    saveBtn.disabled = cleanNoteText(area.value) === '';
    if (slider) dlg.querySelector('.note-pos b').textContent = `${formatDistance(route.cum[Number(slider.value)])} 지점`;
  };
  area.addEventListener('input', refresh);
  if (slider) {
    slider.value = String(route.index);
    slider.addEventListener('input', refresh);
  }
  refresh();

  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const text = cleanNoteText(area.value);
      resolve(dlg.returnValue === 'save' && text ? { text, index: slider ? Number(slider.value) : null } : null);
    });
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close('cancel'));
    dlg.showModal();
    area.focus();
  });
}

/** 메모 보기 (지도 마커를 눌렀을 때) */
export function openNoteViewer(caption, text) {
  const dlg = makeDialog('note-viewer');
  dlg.innerHTML = `<p class="note-caption muted"></p><p class="note-text"></p>
    <div class="row"><button class="btn btn-primary" data-close>닫기</button></div>`;
  dlg.querySelector('.note-caption').textContent = `📝 ${caption}`;
  dlg.querySelector('.note-text').textContent = text;
  dlg.addEventListener('click', (e) => (e.target === dlg || e.target.closest('[data-close]')) && dlg.close());
  dlg.showModal();
}
