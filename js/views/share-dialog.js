// 공유 카드 미리보기 대화상자: 저장(PNG) / 공유(Web Share)
import { renderShareCard, canvasToBlob, shareFile } from '../share-card.js';
import { homeHideNotice } from '../privacy.js';
import { loadSettings } from '../settings-store.js';
import { downloadBlob, safeFileName, toast } from '../ui.js';
import { esc } from '../format.js';

export async function openShareDialog(activity) {
  const home = loadSettings().homeHide;
  const { canvas, trimmed } = renderShareCard(activity, home);
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], `${safeFileName(activity.name)}.png`, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const notice = homeHideNotice(home);
  const canShare = Boolean(navigator.canShare?.({ files: [file] }));

  const dlg = document.createElement('dialog');
  dlg.className = 'share-dialog';
  dlg.innerHTML = `
    <img src="${url}" alt="공유 카드 미리보기">
    ${notice ? `<p class="hint">${esc(notice)}${trimmed ? '' : ' (이 활동은 집 주변을 지나지 않았습니다)'}</p>` : '<p class="hint">설정에서 ‘집 주변 숨기기’를 켜면 집 근처 경로를 가릴 수 있습니다.</p>'}
    <div class="row">
      ${canShare ? '<button class="btn btn-primary" data-act="share">공유</button>' : ''}
      <button class="btn btn-secondary" data-act="save">⬇ PNG 저장</button>
      <button class="btn btn-ghost" data-act="close">닫기</button>
    </div>`;
  dlg.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target === dlg || act === 'close') return dlg.close();
    try {
      if (act === 'save') downloadBlob(file.name, blob);
      if (act === 'share') await shareFile(file, activity.name);
    } catch (err) {
      toast(`공유하지 못했습니다: ${err?.message ?? err}`, { type: 'error' });
    }
  });
  dlg.addEventListener('close', () => {
    URL.revokeObjectURL(url);
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
}
