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
      <button class="btn btn-secondary btn-sm" data-action="add-photos">🖼 사진 추가</button>
    </div>
    <p class="hint">갤러리 사진은 위치(EXIF GPS)로 경로에 배치하고, 위치가 없으면 촬영 시각으로 배치합니다. 기록 중에는 기록 탭의 📷 버튼으로 바로 찍을 수 있습니다. 사진은 이 기기에만 저장되며 원본의 위치 정보는 저장본에서 제거됩니다.</p>
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
              <button class="photo-thumb" data-open="${esc(p.id)}" style="background-image:url('${urls.get(p.id).thumb}')" aria-label="사진 크게 보기"></button>
              <figcaption>${esc(photoCaption(p, getActivity().points, cum))}</figcaption>
              <button class="photo-del" data-del="${esc(p.id)}" aria-label="사진 삭제">✕</button>
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
      let placed = saved.length;
      const placeable = failed.filter((f) => f.placeable);
      const broken = failed.filter((f) => !f.placeable);
      if (placeable.length) {
        // 휴대폰 브라우저는 갤러리 사진의 위치 정보를 지우는 경우가 많아 자동 배치에 실패할 수 있음
        const reasons = [...new Set(placeable.map((f) => f.reason))].map((r) => `· ${r}`).join('\n');
        const ok = await confirmDialog(
          `사진 ${placeable.length}장은 경로 위치를 찾지 못했습니다.\n${reasons}\n\n촬영 시각에 가장 가까운 지점(시각 정보가 없으면 도착 지점)에 놓을까요?`,
        );
        if (ok) {
          const retry = await addPhotos(getActivity(), placeable.map((f) => f.file), () => {}, { force: true });
          placed += retry.saved.length;
          broken.push(...retry.failed);
        }
      }
      if (broken.length) {
        const first = broken[0];
        toast(`${broken.length}장을 추가하지 못했습니다 — ${first.name}: ${first.reason}`, { type: 'error', duration: 7000 });
      }
      if (placed) toast(`사진 ${placed}장을 추가했습니다.${broken.length ? ` (${broken.length}장 실패)` : ''}`);
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
