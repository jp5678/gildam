// 리플레이 영상 녹화: 지도 캔버스 + 오버레이를 합성 캔버스에 그려 MediaRecorder 로 저장
const MIME_CANDIDATES = Object.freeze([
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1', // Safari
  'video/mp4',
]);
const MAX_WIDTH = 1280;
const FPS = 30;
const BITRATE = 6_000_000;
const FONT = "'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif";

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** 지원하지 않으면 사유 문자열, 지원하면 null */
export function unsupportedReason() {
  if (typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) {
    return '이 브라우저는 캔버스 녹화(captureStream)를 지원하지 않습니다.';
  }
  if (!pickMimeType()) return '이 브라우저는 영상 녹화(MediaRecorder)를 지원하지 않습니다.';
  return null;
}

export function extensionFor(mime) {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

/**
 * 오버레이 그리기
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ dot?: { x: number, y: number, cssWidth: number, color: string }, title: string, hud: [string, string][], photo: { img: HTMLImageElement, caption: string }|null, attribution: string }} o
 */
export function drawOverlay(ctx, w, h, o) {
  const u = w / 1000; // 해상도에 비례한 단위
  ctx.save();
  // 현재 위치 점
  if (o.dot && o.dot.cssWidth > 0) {
    const s = w / o.dot.cssWidth;
    ctx.beginPath();
    ctx.arc(o.dot.x * s, o.dot.y * s, 11 * u, 0, Math.PI * 2);
    ctx.fillStyle = o.dot.color;
    ctx.fill();
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  ctx.textBaseline = 'alphabetic';
  // 제목
  ctx.font = `800 ${26 * u}px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 6 * u;
  ctx.fillText(o.title, 24 * u, 44 * u);
  ctx.shadowBlur = 0;
  // HUD
  const colW = 120 * u;
  roundRect(ctx, 20 * u, 62 * u, colW * o.hud.length + 16 * u, 70 * u, 14 * u);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  o.hud.forEach(([value, label], i) => {
    const x = 34 * u + i * colW;
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${24 * u}px ${FONT}`;
    ctx.fillText(value, x, 98 * u);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `500 ${13 * u}px ${FONT}`;
    ctx.fillText(label, x, 120 * u);
  });
  // 사진 팝업
  if (o.photo?.img?.complete && o.photo.img.naturalWidth > 0) {
    const pw = 300 * u;
    const ph = pw * 0.75;
    const px = w - pw - 24 * u;
    const py = h - ph - 70 * u;
    ctx.fillStyle = '#fff';
    roundRect(ctx, px - 6 * u, py - 6 * u, pw + 12 * u, ph + 40 * u, 14 * u);
    ctx.fill();
    const { naturalWidth: iw, naturalHeight: ih } = o.photo.img;
    const scale = Math.max(pw / iw, ph / ih); // object-fit: cover
    const sw = pw / scale;
    const sh = ph / scale;
    ctx.drawImage(o.photo.img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, px, py, pw, ph);
    ctx.fillStyle = '#333';
    ctx.font = `500 ${12 * u}px ${FONT}`;
    ctx.fillText(o.photo.caption.slice(0, 48), px, py + ph + 24 * u);
  }
  // 지도 출처 (타일 이용 조건)
  ctx.font = `500 ${12 * u}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4 * u;
  ctx.textAlign = 'right';
  ctx.fillText(`${o.attribution} · 길담`, w - 16 * u, h - 16 * u);
  ctx.restore();
}

/**
 * @param {{ source: HTMLCanvasElement, getOverlay: () => object }} opts
 */
export function createCanvasRecorder({ source, getOverlay }) {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error(unsupportedReason());
  const scale = Math.min(1, MAX_WIDTH / source.width);
  const out = document.createElement('canvas');
  // 일부 인코더는 짝수 해상도가 필요
  out.width = Math.floor((source.width * scale) / 2) * 2;
  out.height = Math.floor((source.height * scale) / 2) * 2;
  const ctx = out.getContext('2d');
  const stream = out.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITRATE });
  const chunks = [];
  let raf = 0;
  recorder.addEventListener('dataavailable', (e) => e.data.size > 0 && chunks.push(e.data));

  function paint() {
    ctx.drawImage(source, 0, 0, out.width, out.height);
    drawOverlay(ctx, out.width, out.height, getOverlay());
    raf = requestAnimationFrame(paint);
  }

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    mimeType,
    start() {
      paint();
      recorder.start(1000);
    },
    /** 녹화 종료 → Blob */
    stop() {
      return new Promise((resolve, reject) => {
        recorder.addEventListener('stop', () => {
          cleanup();
          chunks.length ? resolve(new Blob(chunks, { type: mimeType.split(';')[0] })) : reject(new Error('녹화된 데이터가 없습니다.'));
        }, { once: true });
        recorder.addEventListener('error', (e) => reject(e.error ?? new Error('녹화 오류')), { once: true });
        if (recorder.state !== 'inactive') recorder.stop();
      });
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      cleanup();
    },
  };
}
