// 실시간 GPS 기록기: watchPosition + Wake Lock + 임시 저장.
import { acceptPoint, cumulativeDistances, movingTime } from './geo.js';
import { getType } from './activity-types.js';
import { saveDraft, clearDraft } from './db.js';

const DRAFT_SAVE_INTERVAL_MS = 10_000;
const GEO_OPTIONS = Object.freeze({ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });

const GEO_ERRORS = Object.freeze({
  1: '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해 주세요.',
  2: 'GPS 신호를 찾을 수 없습니다. 하늘이 보이는 곳으로 이동해 보세요.',
  3: 'GPS 응답이 지연되고 있습니다. 계속 신호를 찾는 중입니다.',
});

export const wakeLockSupported = () => 'wakeLock' in navigator;
export const geolocationSupported = () => 'geolocation' in navigator;

const listeners = new Set();

function onChange(snap) {
  listeners.forEach((l) => l.onChange?.(snap));
}

function onError(msg) {
  listeners.forEach((l) => l.onError?.(msg));
}

/**
 * 앱 전체에서 하나만 존재하는 기록기. 탭을 이동해도 기록은 계속됨.
 * @param {{ maxAccuracy: number }} opts
 */
function createRecorder({ maxAccuracy }) {
  let state = 'idle'; // idle | recording | paused
  let type = 'run';
  let points = [];
  let seg = 0;
  let startedAt = null;
  let lastFix = null;
  let dropped = 0;
  let watchId = null;
  let wakeLock = null;
  let lastDraftSave = 0;

  const snapshot = () => {
    const cum = cumulativeDistances(points);
    return {
      state,
      type,
      points,
      distance: cum.at(-1) ?? 0,
      movingTime: movingTime(points),
      elapsed: startedAt ? (Date.now() - startedAt) / 1000 : 0,
      lastFix,
      dropped,
      wakeLock: wakeLock != null,
    };
  };

  const emit = () => onChange(snapshot());

  async function persistDraft(force = false) {
    if (!force && Date.now() - lastDraftSave < DRAFT_SAVE_INTERVAL_MS) return;
    lastDraftSave = Date.now();
    try {
      await saveDraft({ type, points, seg, startedAt, savedAt: lastDraftSave });
    } catch (err) {
      onError(`임시 저장 실패: ${err instanceof Error ? err.message : err}`);
    }
  }

  function handlePosition(pos) {
    const { latitude, longitude, altitude, accuracy } = pos.coords;
    const candidate = { lat: latitude, lon: longitude, ele: altitude ?? null, time: pos.timestamp, seg, acc: accuracy };
    lastFix = { lat: latitude, lon: longitude, accuracy, time: pos.timestamp };
    if (state !== 'recording') return emit();
    const verdict = acceptPoint(points.at(-1) ?? null, candidate, { maxAccuracy, maxSpeed: getType(type).maxSpeed });
    if (verdict.ok) {
      const { acc, ...point } = candidate;
      points = [...points, point];
      persistDraft();
    } else if (verdict.reason !== 'time') {
      dropped += 1;
    }
    emit();
  }

  function handleError(err) {
    // 권한 거부 시 watch 를 정리해야 다음 '기록 시작'에서 다시 권한을 요청함
    if (err.code === 1) stopWatch();
    onError(GEO_ERRORS[err.code] ?? `위치 오류: ${err.message}`);
  }

  function startWatch() {
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, GEO_OPTIONS);
  }

  function stopWatch() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  async function acquireWakeLock() {
    if (!wakeLockSupported() || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        emit();
      });
    } catch {
      wakeLock = null; // 배터리 절약 모드 등으로 거부될 수 있음
    }
    emit();
  }

  async function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) await lock.release().catch(() => {});
  }

  // 화면이 다시 보이면 Wake Lock 재요청 (탭 전환 시 자동 해제되기 때문)
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && state === 'recording') acquireWakeLock();
    if (document.visibilityState === 'hidden' && state !== 'idle') persistDraft(true);
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** 위치 미리보기만 (기록 전 GPS 신호 확인) */
    preview() {
      if (geolocationSupported()) startWatch();
    },
    start(nextType, draft = null) {
      if (!geolocationSupported()) return onError('이 브라우저는 위치 기능을 지원하지 않습니다.');
      type = draft?.type ?? nextType;
      points = draft?.points ?? [];
      seg = draft ? draft.seg + 1 : 0;
      startedAt = draft?.startedAt ?? Date.now();
      dropped = 0;
      state = 'recording';
      startWatch();
      acquireWakeLock();
      emit();
    },
    pause() {
      if (state !== 'recording') return;
      state = 'paused';
      persistDraft(true);
      releaseWakeLock();
      emit();
    },
    resume() {
      if (state !== 'paused') return;
      seg += 1;
      state = 'recording';
      acquireWakeLock();
      emit();
    },
    setType(nextType) {
      type = nextType;
      emit();
    },
    /** 종료: 기록된 지점 반환 후 초기화 */
    async stop() {
      const result = { type, points, startedAt };
      state = 'idle';
      points = [];
      seg = 0;
      startedAt = null;
      await releaseWakeLock();
      stopWatch();
      await clearDraft().catch((err) => onError(`임시 기록 삭제 실패: ${err?.message ?? err}`));
      emit();
      return result;
    },
    get state() {
      return state;
    },
    snapshot,
    /** 화면 구독. 반환된 함수로 해제. 기록 중이 아니면 마지막 구독 해제 시 GPS 중지 */
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && state === 'idle') stopWatch();
      };
    },
  };
}

export const recorder = createRecorder({ maxAccuracy: 30 });
