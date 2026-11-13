// 설정 탭: 지도 키, 체중, 테마, 기본 종류, 집 주변 숨기기, 백업/복원
import { loadSettings, saveSettings, applyTheme } from '../settings-store.js';
import { ACTIVITY_TYPES } from '../activity-types.js';
import { exportAll, importAll } from '../db.js';
import { isValidActivity } from '../activity.js';
import { isValidPhotoRecord } from '../photo-match.js';
import { toast, downloadText, pickFiles } from '../ui.js';
import { esc } from '../format.js';

const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

export function render(root) {
  const s = loadSettings();
  root.innerHTML = `
  <section class="view view-settings">
    <header class="view-header"><h1>설정</h1></header>
    <form class="settings-form" data-ref="form" novalidate>
      <fieldset>
        <legend>지도</legend>
        <label>MapTiler API 키
          <input name="maptilerKey" type="password" autocomplete="off" spellcheck="false" value="${esc(s.maptilerKey)}" placeholder="비워 두면 OpenStreetMap 기본 지도 사용">
        </label>
        <p class="hint">3D 지형과 등고선 지도에 필요합니다. <a href="https://cloud.maptiler.com/account/keys/" target="_blank" rel="noopener">MapTiler</a>에서 무료 키를 발급받을 수 있으며, 키는 이 기기에만 저장됩니다.</p>
      </fieldset>
      <fieldset>
        <legend>기록</legend>
        <label>체중 (kg, 칼로리 추정용)
          <input name="weightKg" type="number" min="20" max="250" step="0.5" inputmode="decimal" value="${s.weightKg}">
        </label>
        <label>기본 활동 종류
          <select name="defaultType">${Object.values(ACTIVITY_TYPES)
            .map((t) => `<option value="${t.id}" ${t.id === s.defaultType ? 'selected' : ''}>${t.icon} ${t.label}</option>`)
            .join('')}</select>
        </label>
        <label>화면 테마
          <select name="theme">
            <option value="system" ${s.theme === 'system' ? 'selected' : ''}>시스템 설정 따르기</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>밝게</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>어둡게</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>개인정보 — 집 주변 숨기기</legend>
        <label class="switch"><input name="homeEnabled" type="checkbox" ${s.homeHide.enabled ? 'checked' : ''}> 공유 이미지·영상에서 집 주변 경로 가리기</label>
        <label>반경 (m)
          <input name="homeRadius" type="number" min="100" max="2000" step="50" value="${s.homeHide.radius}">
        </label>
        <p class="hint" data-ref="home">${s.homeHide.lat != null ? `설정된 위치: ${s.homeHide.lat.toFixed(4)}, ${s.homeHide.lon.toFixed(4)}` : '아직 위치가 설정되지 않았습니다.'}</p>
        <button type="button" class="btn btn-ghost" data-action="home-here">📍 현재 위치를 집으로 설정</button>
        <p class="hint">공유 카드·영상 기능(3단계)에서 적용됩니다.</p>
      </fieldset>
      <button type="submit" class="btn btn-primary btn-block">저장</button>
    </form>
    <section class="card">
      <h2>데이터</h2>
      <p class="hint">모든 기록은 이 기기의 브라우저(IndexedDB)에만 저장되며 외부로 전송되지 않습니다. 브라우저 데이터를 지우면 기록도 사라지니 주기적으로 백업하세요.</p>
      <div class="row">
        <button class="btn btn-secondary" data-action="backup">⬇ 전체 백업 (JSON)</button>
        <button class="btn btn-ghost" data-action="restore">⬆ 백업 복원</button>
      </div>
    </section>
  </section>`;

  const form = root.querySelector('[data-ref="form"]');
  let home = { lat: s.homeHide.lat, lon: s.homeHide.lon };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const weight = Number(fd.get('weightKg'));
    if (!Number.isFinite(weight) || weight < 20 || weight > 250) {
      toast('체중은 20~250kg 사이로 입력해 주세요.', { type: 'error' });
      return;
    }
    try {
      const next = saveSettings({
        maptilerKey: String(fd.get('maptilerKey') ?? ''),
        weightKg: weight,
        defaultType: fd.get('defaultType'),
        theme: fd.get('theme'),
        homeHide: { enabled: fd.get('homeEnabled') === 'on', lat: home.lat, lon: home.lon, radius: Number(fd.get('homeRadius')) },
      });
      applyTheme(next.theme);
      toast('설정을 저장했습니다.');
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });

  root.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'home-here') {
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          home = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          root.querySelector('[data-ref="home"]').textContent = `새 위치: ${home.lat.toFixed(4)}, ${home.lon.toFixed(4)} (저장을 눌러 적용)`;
        },
        (err) => toast(`위치를 가져오지 못했습니다: ${err.message}`, { type: 'error' }),
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    } else if (action === 'backup') {
      try {
        const data = await exportAll();
        const day = new Date().toISOString().slice(0, 10);
        downloadText(`gildam-backup-${day}.json`, JSON.stringify(data), 'application/json');
        toast(`활동 ${data.activities.length}개, 사진 ${data.photos.length}장을 백업했습니다.`);
      } catch (err) {
        toast(`백업 실패: ${err.message}`, { type: 'error' });
      }
    } else if (action === 'restore') {
      const [file] = await pickFiles({ accept: '.json,application/json' });
      if (!file) return;
      try {
        if (file.size > MAX_BACKUP_BYTES) throw new Error('파일이 너무 큽니다.');
        const r = await importAll(JSON.parse(await file.text()), isValidActivity, isValidPhotoRecord);
        const skipped = r.skipped + r.photosSkipped;
        toast(`활동 ${r.imported}개, 사진 ${r.photos}장을 복원했습니다.${skipped ? ` (손상된 항목 ${skipped}개 건너뜀)` : ''}`);
      } catch (err) {
        toast(`복원 실패: ${err instanceof SyntaxError ? 'JSON 형식이 아닙니다.' : err.message}`, { type: 'error' });
      }
    }
  });
}
