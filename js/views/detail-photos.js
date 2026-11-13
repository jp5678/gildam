// 상세 화면의 사진 섹션: 업로드, 썸네일 목록, 라이트박스, 삭제
import { findPhotos, deletePhoto } from '../db.js';
import { addPhotos, createPhotoUrls } from '../photos.js';
import { formatDateTime, formatDistance, esc } from '../format.js';
import { cumulativeDistances } from '../geo.js';
import { toast, confirmDialog, pickFiles } from '../ui.js';

const METHOD_LABEL = Object.freeze({ gps: '사진 위치', time: '촬영 시각', manual: '직접 지정' });

/** 사진 확대 보기 (Esc·배경 클릭으로 닫기) */
export function openLightbox(url, caption) {
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.innerHTML = `<img alt="">${caption ? `<p></p>` : ''}<button class="btn btn-ghost lightbox-close" aria-label="닫기">✕</button>`;
  dlg.querySelector('img').src = url;
  if (caption) dlg.querySelector('p').textContent = caption;
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('.lightbox-close')) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

export function photoCaption(photo, points, cum = cumulativeDistances(points)) {
  const at = formatDistance(cum[Math.min(photo.index, cum.length - 1)]);
  const when = photo.time ? formatDateTime(photo.time) : '촬영 시각 없음';
  return `${at} 지점 · ${when} · ${METHOD_LABEL[photo.method] ?? ''}로 배치`;
}

/**
 * @param {HTMLElement} el 섹션 컨테이너
 * @param {() => object} getActivity 현재 활동
 * @param {(photos: object[], urls: object) => void} onChange 사진 목록이 바뀌면 호출 (지도 마커 갱신용)
 */
export async function mountPhotoSection(el, getActivity, onChange) {
  let photos = [];
  let urls = createPhotoUrls([]);

  el.innerHTML = `
    <div class="section-head">
      <h2>사진</h2>
      <button class="btn btn-secondary btn-sm" data-action="add-photos">📷 사진 추가</button>
    </div>
    <p class="hint">사진의 위치(EXIF GPS)로 경로에 배치하고, 위치가 없으면 촬영 시각으로 배치합니다. 사진은 이 기기에만 저장되며 원본의 위치 정보는 저장본에서 제거됩니다.</p>
    <p class="hint" data-ref="progress" hidden></p>
    <div class="photo-grid" data-ref="grid"></div>`;
  const grid = el.querySelector('[data-ref="grid"]');
  const progress = el.querySelector('[data-ref="progress"]');

  function draw() {
    const cum = cumulativeDistances(getActivity().points);
    grid.innerHTML = photos.length
      ? photos
          .map(
            (p) => `<figure class="photo-item">
              <button class="photo-thumb" data-open="${p.id}" style="background-image:url('${urls.get(p.id).thumb}')" aria-label="사진 크게 보기"></button>
              <figcaption>${esc(photoCaption(p, getActivity().points, cum))}</figcaption>
              <button class="photo-del" data-del="${p.id}" aria-label="사진 삭제">✕</button>
            </figure>`,
          )
          .join('')
      : '<p class="muted">아직 사진이 없습니다.</p>';
  }

  async function reload() {
    const next = await findPhotos(getActivity().id);
    const nextUrls = createPhotoUrls(next);
    onChange(next, nextUrls); // 지도 마커가 새 URL 을 쓰도록 먼저 교체한 뒤 이전 URL 해제
    urls.revoke();
    photos = next;
    urls = nextUrls;
    draw();
  }

  el.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const photo = photos.find((p) => p.id === open.dataset.open);
      if (photo) openLightbox(urls.get(photo.id).full, photoCaption(photo, getActivity().points));
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!(await confirmDialog('이 사진을 삭제할까요? 되돌릴 수 없습니다.'))) return;
      await deletePhoto(del.dataset.del);
      await reload();
      return;
    }
    if (e.target.closest('[data-action="add-photos"]')) {
      const files = await pickFiles({ accept: 'image/*', multiple: true });
      if (files.length === 0) return;
      progress.hidden = false;
      const { saved, failed } = await addPhotos(getActivity(), files, (i, n) => {
        progress.textContent = `사진 처리 중… ${i}/${n}`;
      });
      progress.hidden = true;
      failed.forEach((f) => toast(`${f.name}: ${f.reason}`, { type: 'error', duration: 6000 }));
      if (saved.length) toast(`사진 ${saved.length}장을 경로에 배치했습니다.`);
      await reload();
    }
  });

  await reload();
  return {
    destroy: () => urls.revoke(),
    get photos() {
      return photos;
    },
  };
}
