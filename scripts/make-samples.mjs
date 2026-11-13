// 테스트용 샘플 GPX 생성기 (합성 데이터, 실제 등산로·주로와 정확히 일치하지 않음)
// 실행: node scripts/make-samples.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { toGpx } from '../js/gpx.js';
import { haversine } from '../js/geo.js';

// 결정적 난수 (mulberry32)
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 웨이포인트를 따라 일정 간격(dtSec)으로 지점 생성. speedFn(grade) 로 속도 결정 */
function walkPath(waypoints, { startTime, dtSec, speedFn, jitterM, rand }) {
  const out = [];
  let time = startTime;
  const jitter = () => ((rand() - 0.5) * 2 * jitterM) / 111_320;
  for (let i = 1; i < waypoints.length; i += 1) {
    const [a, b] = [waypoints[i - 1], waypoints[i]];
    const legLen = haversine({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
    const grade = (b[2] - a[2]) / legLen;
    let d = 0;
    while (d < legLen) {
      const r = d / legLen;
      out.push({
        lat: a[0] + (b[0] - a[0]) * r + jitter(),
        lon: a[1] + (b[1] - a[1]) * r + jitter(),
        ele: a[2] + (b[2] - a[2]) * r + (rand() - 0.5) * 2,
        time,
        seg: 0,
      });
      d += speedFn(grade, rand) * dtSec;
      time += dtSec * 1000;
    }
  }
  const last = waypoints.at(-1);
  out.push({ lat: last[0], lon: last[1], ele: last[2], time, seg: 0 });
  return out;
}

function rest(at, { startTime, seconds, dtSec, rand }) {
  return Array.from({ length: Math.floor(seconds / dtSec) }, (_, i) => ({
    lat: at.lat + (rand() - 0.5) * 0.00002,
    lon: at.lon + (rand() - 0.5) * 0.00002,
    ele: at.ele + (rand() - 0.5),
    time: startTime + (i + 1) * dtSec * 1000,
    seg: 0,
  }));
}

function hiking() {
  const rand = rng(42);
  const up = [
    [37.6627, 127.0111, 120], [37.6612, 127.0062, 175], [37.6601, 127.0021, 245], [37.6594, 126.9985, 330],
    [37.6603, 126.9952, 410], [37.6609, 126.9921, 485], [37.6597, 126.9893, 560], [37.6590, 126.9866, 625],
    [37.6601, 126.9838, 700], [37.6594, 126.9811, 770], [37.6588, 126.9790, 836],
  ];
  const down = [
    [37.6588, 126.9790, 836], [37.6579, 126.9812, 760], [37.6571, 126.9845, 670], [37.6578, 126.9880, 590],
    [37.6583, 126.9918, 500], [37.6580, 126.9958, 395], [37.6589, 126.9999, 300], [37.6603, 127.0045, 205],
    [37.6619, 127.0085, 150], [37.6627, 127.0111, 120],
  ];
  const start = Date.parse('2026-10-11T08:30:00+09:00');
  const hikeSpeed = (grade, r) => (grade > 0 ? 0.55 : 0.85) * (0.85 + r() * 0.3);
  const ascent = walkPath(up, { startTime: start, dtSec: 10, speedFn: hikeSpeed, jitterM: 3, rand });
  const top = ascent.at(-1);
  const summit = rest(top, { startTime: top.time, seconds: 900, dtSec: 10, rand });
  const descent = walkPath(down, { startTime: summit.at(-1).time + 10_000, dtSec: 10, speedFn: hikeSpeed, jitterM: 3, rand });
  return toGpx({ name: '북한산 백운대 등산 (샘플)', type: 'hiking', points: [...ascent, ...summit, ...descent.slice(1)] });
}

function running() {
  const rand = rng(7);
  const out = [
    [37.5283, 126.9278, 12], [37.5292, 126.9318, 12], [37.5300, 126.9355, 13], [37.5297, 126.9395, 12],
    [37.5290, 126.9432, 12], [37.5276, 126.9468, 11], [37.5260, 126.9500, 12], [37.5246, 126.9528, 12], [37.5235, 126.9552, 12],
  ];
  const back = [...out].reverse().map(([lat, lon, ele]) => [lat - 0.00012, lon, ele]);
  const start = Date.parse('2026-11-08T07:00:00+09:00');
  const runSpeed = (_g, r) => 3.0 + r() * 0.35;
  const outLeg = walkPath(out, { startTime: start, dtSec: 3, speedFn: runSpeed, jitterM: 2, rand });
  const turn = rest(outLeg.at(-1), { startTime: outLeg.at(-1).time, seconds: 30, dtSec: 3, rand }); // 반환점 신호 대기
  const backLeg = walkPath(back, { startTime: turn.at(-1).time + 3000, dtSec: 3, speedFn: (g, r) => runSpeed(g, r) + 0.25, jitterM: 2, rand });
  const points = [...outLeg, ...turn, ...backLeg];
  // GPS 튐 1개 (가져오기 시 필터링되어야 함)
  const k = Math.floor(points.length * 0.3);
  const spiked = points.map((p, i) => (i === k ? { ...p, lat: p.lat + 0.004, lon: p.lon - 0.003 } : p));
  return toGpx({ name: '한강 여의도 아침 러닝 (샘플)', type: 'running', points: spiked });
}

mkdirSync(new URL('../sample/', import.meta.url), { recursive: true });
writeFileSync(new URL('../sample/hiking-bukhansan.gpx', import.meta.url), hiking());
writeFileSync(new URL('../sample/running-hangang.gpx', import.meta.url), running());
process.stdout.write('sample/hiking-bukhansan.gpx, sample/running-hangang.gpx 생성 완료\n');
