// 리플레이 '영상으로 저장': 집 주변을 가린 경로로 처음부터 재생하며 녹화 → WebM/MP4 다운로드
import { createCanvasRecorder, unsupportedReason, extensionFor } from '../video-export.js';
import { hideHome, remapPhotos } from '../privacy.js';
import { loadSettings } from '../settings-store.js';
import { downloadBlob, safeFileName, toast } from '../ui.js';
import { formatDuration } from '../format.js';

const TAIL_MS = 1200; // 끝 장면을 잠시 더 녹화
const MAX_RECORD_MS = 10 * 60 * 1000; // 안전장치

/**
 * @param {object} c replay.js 의 controller
 */
export function mountRecorder(c) {
  let session = null; // { recorder, startedAt, timer, guard }

  function restore() {
    c.setLocked(false);
    c.setStatus(null);
    c.loadRoute(c.activity.points, c.allPhotos);
  }

  async function finish() {
    if (!session) return;
    const { recorder, timer, guard } = session;
    clearInterval(timer);
    clearTimeout(guard);
    session = null;
    c.setStatus('영상 파일을 만드는 중…');
    try {
      const blob = await recorder.stop();
      downloadBlob(`${safeFileName(c.activity.name)}.${extensionFor(recorder.mimeType)}`, blob);
      toast(`영상을 저장했습니다 (${(blob.size / 1024 / 1024).toFixed(1)}MB).`);
    } catch (err) {
      toast(`영상 저장 실패: ${err?.message ?? err}`, { type: 'error', duration: 6000 });
    } finally {
      restore();
    }
  }

  function cancel(reason) {
    if (!session) return;
    clearInterval(session.timer);
    clearTimeout(session.guard);
    session.recorder.cancel();
    session = null;
    c.pause();
    restore();
    if (reason) toast(reason, { type: 'warn' });
  }

  function start() {
    const reason = unsupportedReason();
    if (reason) return toast(reason, { type: 'error', duration: 6000 });
    const home = loadSettings().homeHide;
    const hidden = hideHome(c.activity.points, home);
    if (hidden.allHidden || hidden.points.length < 2) {
      return toast('경로 전체가 집 주변 숨기기 반경 안이라 영상을 만들 수 없습니다.', { type: 'warn', duration: 6000 });
    }
    c.pause();
    c.loadRoute(hidden.points, remapPhotos(c.allPhotos, hidden.start, hidden.end));
    let recorder;
    try {
      recorder = createCanvasRecorder({ source: c.map.getCanvas(), getOverlay: () => c.overlay() });
    } catch (err) {
      restore();
      return toast(err?.message ?? String(err), { type: 'error' });
    }
    c.setLocked(true);
    const startedAt = Date.now();
    const note = hidden.trimmed ? ' · 집 주변 가림' : '';
    session = {
      recorder,
      startedAt,
      timer: setInterval(() => {
        c.setStatus(`● 녹화 중 ${formatDuration(Math.round((Date.now() - startedAt) / 1000))} (${c.speed}×${note}) — 🎬 를 누르면 취소`);
      }, 500),
      guard: setTimeout(() => cancel('녹화가 너무 길어 중단했습니다. 재생 속도를 높여 다시 시도해 주세요.'), MAX_RECORD_MS),
    };
    c.setStatus(`● 녹화 준비 중…${note}`);
    recorder.start();
    c.play();
  }

  // 재생이 끝나면 잠시 뒤 녹화 종료
  c.onFinish(() => {
    if (session) setTimeout(finish, TAIL_MS);
  });

  // 녹화 중 다른 탭으로 가면 화면 갱신이 멈춰 영상이 끊기므로 취소
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') cancel('화면을 벗어나 녹화를 취소했습니다. 녹화 중에는 이 화면을 켜 두세요.');
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    toggle: () => (session ? cancel('녹화를 취소했습니다.') : start()),
    destroy() {
      document.removeEventListener('visibilitychange', onVisibility);
      if (session) {
        clearInterval(session.timer);
        clearTimeout(session.guard);
        session.recorder.cancel();
        session = null;
      }
    },
  };
}
