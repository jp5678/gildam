// 공유 카드(PNG): 경로 그림 + 핵심 수치. 배경 지도 없이 경로만 그려 위치 노출을 줄임.
import { getType, usesSpeed } from './activity-types.js';
import { makeProjector } from './route-svg.js';
import { hideHome } from './privacy.js';
import { formatDistance, formatDuration, formatPace, formatSpeed, formatElevation, formatDateTime } from './format.js';

const W = 1080;
const H = 1350;
const ROUTE_BOX = Object.freeze({ x: 90, y: 300, size: 900 });
const FONT = "'Apple SD Gothic Neo', 'Noto Sans KR', 'Pretendard', system-ui, sans-serif";

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * amount)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function fitText(ctx, text, maxWidth, size, weight = 800) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && s > 28) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function drawRoute(ctx, points, color, showEnds) {
  const project = makeProjector(points, ROUTE_BOX.size, 40);
  const xy = points.map((p) => {
    const [x, y] = project(p);
    return [ROUTE_BOX.x + x, ROUTE_BOX.y + y];
  });
  const stroke = (width, style, blur = 0) => {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.shadowColor = style;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    xy.forEach(([x, y], i) => {
      // 일시정지 구간은 선을 끊음
      if (i === 0 || points[i].seg !== points[i - 1].seg) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  };
  stroke(22, 'rgba(255,255,255,0.18)', 30);
  stroke(10, color, 12);
  stroke(4, 'rgba(255,255,255,0.85)');
  if (!showEnds) return;
  const dot = ([x, y], fill) => {
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  };
  dot(xy.at(-1), '#222');
  dot(xy[0], '#1f8a52');
}

function statBlocks(activity) {
  const s = activity.stats;
  return [
    ['거리', formatDistance(s.distance)],
    ['이동 시간', formatDuration(Math.round(s.movingTime))],
    usesSpeed(activity.type) ? ['평균 속도', formatSpeed(s.avgSpeed)] : ['평균 페이스', `${formatPace(s.avgPace)}/km`],
    ['누적 상승', formatElevation(s.elevationGain)],
  ];
}

/**
 * @param {object} activity
 * @param {{ enabled: boolean, lat: number|null, lon: number|null, radius: number }} home
 * @returns {{ canvas: HTMLCanvasElement, trimmed: boolean, allHidden: boolean }}
 */
export function renderShareCard(activity, home) {
  const type = getType(activity.type);
  const hidden = hideHome(activity.points, home);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0e1712');
  bg.addColorStop(1, shade(type.color, 0.45));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(`길담 · ${type.icon} ${type.label}`, 90, 110);
  ctx.fillStyle = '#fff';
  const title = fitText(ctx, activity.name, W - 180, 64);
  ctx.fillText(title, 90, 190);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `500 32px ${FONT}`;
  ctx.fillText(formatDateTime(activity.startTime), 90, 245);

  if (hidden.points.length >= 2) {
    drawRoute(ctx, hidden.points, type.color, !hidden.trimmed);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `600 36px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('경로가 모두 집 주변이라 표시하지 않았습니다', W / 2, ROUTE_BOX.y + ROUTE_BOX.size / 2);
    ctx.textAlign = 'left';
  }

  const blocks = statBlocks(activity);
  const colW = (W - 180) / blocks.length;
  blocks.forEach(([label, value], i) => {
    const x = 90 + i * colW;
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${value.length > 8 ? 40 : 48}px ${FONT}`;
    ctx.fillText(value, x, 1250);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(label, x, 1290);
  });
  return { canvas, trimmed: hidden.trimmed, allHidden: hidden.allHidden };
}

export function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했습니다.'))), type));
}

/** Web Share(파일)가 되면 공유 시트, 아니면 false */
export async function shareFile(file, title) {
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return true; // 사용자가 취소
    throw err;
  }
}
