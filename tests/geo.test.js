import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversine,
  acceptPoint,
  filterPoints,
  cumulativeDistances,
  elevationChange,
  movingTime,
  maxSpeed,
  computeStats,
  splits,
  quantileThresholds,
  bucketOf,
  bounds,
  estimateCalories,
  smoothSpeeds,
  pairSpeeds,
} from '../js/geo.js';

// 위도 0 근처에서 경도 0.001° ≈ 111.19m
const M_PER_MILLIDEG = haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 });

/** 동쪽으로 일정 속도로 이동하는 트랙 생성 */
function straightTrack({ n, stepDeg = 0.001, dtSec = 30, seg = 0, startTime = 0, ele = () => 100 }) {
  return Array.from({ length: n }, (_, i) => ({
    lat: 0,
    lon: i * stepDeg,
    ele: ele(i),
    time: startTime + i * dtSec * 1000,
    seg,
  }));
}

test('haversine: 서울-부산 직선거리 약 325km', () => {
  const d = haversine({ lat: 37.5665, lon: 126.978 }, { lat: 35.1796, lon: 129.0756 });
  assert.ok(d > 320_000 && d < 330_000, `got ${d}`);
});

test('haversine: 같은 지점은 0', () => {
  assert.equal(haversine({ lat: 10, lon: 10 }, { lat: 10, lon: 10 }), 0);
});

test('acceptPoint: 정확도 30m 초과는 거부', () => {
  const r = acceptPoint(null, { lat: 0, lon: 0, acc: 45, seg: 0, time: 0 }, { maxAccuracy: 30 });
  assert.deepEqual(r, { ok: false, reason: 'accuracy' });
});

test('acceptPoint: 비정상 속도(GPS 튐) 거부', () => {
  const prev = { lat: 0, lon: 0, time: 0, seg: 0 };
  const jump = { lat: 0, lon: 0.01, time: 5000, seg: 0 }; // 1.1km / 5s
  assert.deepEqual(acceptPoint(prev, jump, { maxSpeed: 9 }), { ok: false, reason: 'speed' });
});

test('acceptPoint: 시간이 역행하면 거부, 세그먼트가 바뀌면 허용', () => {
  const prev = { lat: 0, lon: 0, time: 5000, seg: 0 };
  assert.equal(acceptPoint(prev, { lat: 0, lon: 0, time: 5000, seg: 0 }).reason, 'time');
  assert.equal(acceptPoint(prev, { lat: 0, lon: 1, time: 6000, seg: 1 }, { maxSpeed: 1 }).ok, true);
});

test('filterPoints: 튐 지점만 제거하고 원본은 변경하지 않음', () => {
  const pts = straightTrack({ n: 5, dtSec: 60 });
  const spike = { ...pts[2], lat: 0.05 };
  const input = [pts[0], pts[1], spike, pts[3], pts[4]];
  const snapshot = JSON.stringify(input);
  const { points, dropped } = filterPoints(input, { maxSpeed: 9 });
  assert.equal(dropped, 1);
  assert.equal(points.length, 4);
  assert.equal(JSON.stringify(input), snapshot);
});

test('cumulativeDistances: 세그먼트 경계 거리는 제외', () => {
  const a = straightTrack({ n: 3 });
  const b = straightTrack({ n: 2, seg: 1, startTime: 10_000_000 }).map((p) => ({ ...p, lon: p.lon + 1 }));
  const cum = cumulativeDistances([...a, ...b]);
  assert.ok(Math.abs(cum.at(-1) - 3 * M_PER_MILLIDEG) < 0.01);
});

test('elevationChange: 3m 미만 노이즈는 무시', () => {
  const noisy = straightTrack({ n: 50, ele: (i) => 100 + (i % 2 ? 1 : -1) });
  assert.equal(elevationChange(noisy).gain, 0);
});

test('elevationChange: 꾸준한 오르막 100m', () => {
  const climb = straightTrack({ n: 101, ele: (i) => 100 + i });
  const { gain, loss, min, max } = elevationChange(climb);
  assert.ok(gain > 90 && gain <= 100, `gain ${gain}`);
  assert.equal(loss, 0);
  assert.equal(min, 100);
  assert.equal(max, 200);
});

test('elevationChange: 고도 없음', () => {
  assert.deepEqual(elevationChange([{ lat: 0, lon: 0, ele: null }]), { gain: 0, loss: 0, min: null, max: null });
});

test('movingTime: 정지 구간 제외', () => {
  const moving = straightTrack({ n: 4, dtSec: 30 });
  const stopped = { ...moving[3], time: moving[3].time + 300_000 };
  assert.equal(movingTime([...moving, stopped]), 90);
});

test('maxSpeed: 순간 튐(약 33m/s)은 10초 창으로 크게 완화됨', () => {
  const pts = straightTrack({ n: 20, stepDeg: 0.00003, dtSec: 1 }); // ~3.3 m/s
  const withSpike = pts.map((p, i) => (i === 10 ? { ...p, lon: p.lon + 0.0003 } : p));
  const v = maxSpeed(withSpike);
  assert.ok(v < 12, `max ${v}`);
  // 기록 시에는 filterPoints 가 먼저 제거하므로 실제 통계엔 반영되지 않음
  const { points } = filterPoints(withSpike, { maxSpeed: 9 });
  assert.ok(maxSpeed(points) < 4, `filtered max ${maxSpeed(points)}`);
  assert.ok(Math.abs(maxSpeed(pts) - 3.34) < 0.1);
});

test('computeStats: 거리·페이스·칼로리', () => {
  const pts = straightTrack({ n: 11, stepDeg: 0.001, dtSec: 30 }); // 1.11km / 5분
  const s = computeStats(pts, { met: 10, weightKg: 60 });
  assert.ok(Math.abs(s.distance - 10 * M_PER_MILLIDEG) < 0.1);
  assert.equal(s.elapsed, 300);
  assert.equal(s.movingTime, 300);
  assert.ok(Math.abs(s.avgPace - 300 / (s.distance / 1000)) < 1e-6);
  assert.ok(Math.abs(s.calories - 50) < 1e-6);
});

test('computeStats: 지점 하나', () => {
  const s = computeStats([{ lat: 0, lon: 0, ele: null, time: 0, seg: 0 }], { met: 3, weightKg: 70 });
  assert.equal(s.distance, 0);
  assert.equal(s.avgPace, null);
});

test('splits: 1km 단위 구간과 마지막 부분 구간', () => {
  const pts = straightTrack({ n: 26, dtSec: 30 }); // 25 × 111m ≈ 2.78km
  const out = splits(pts);
  assert.equal(out.length, 3);
  assert.equal(out[0].distance, 1000);
  assert.ok(Math.abs(out[0].time - 1000 / (M_PER_MILLIDEG / 30)) < 0.5);
  assert.ok(out[2].distance < 1000);
});

test('splits: 일시정지 시간은 구간 시간에서 제외', () => {
  const a = straightTrack({ n: 6, dtSec: 30 });
  const b = straightTrack({ n: 6, dtSec: 30, seg: 1, startTime: a.at(-1).time + 600_000 }).map((p) => ({
    ...p,
    lon: p.lon + a.at(-1).lon,
  }));
  const out = splits([...a, ...b]);
  const total = out.reduce((s, x) => s + x.time, 0);
  assert.ok(Math.abs(total - 300) < 1, `total ${total}`);
});

test('splits: 시간 정보가 없으면 빈 배열', () => {
  assert.deepEqual(splits([{ lat: 0, lon: 0, time: null, seg: 0 }, { lat: 0, lon: 1, time: null, seg: 0 }]), []);
});

test('quantileThresholds / bucketOf', () => {
  const th = quantileThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(th.length, 4);
  assert.equal(bucketOf(1, th), 0);
  assert.equal(bucketOf(10, th), 4);
  assert.equal(bucketOf(null, th), -1);
  assert.deepEqual(quantileThresholds([], 5), []);
});

test('bounds', () => {
  assert.deepEqual(bounds([{ lat: 1, lon: 2 }, { lat: -1, lon: 5 }]), [[2, -1], [5, 1]]);
});

test('estimateCalories', () => {
  assert.equal(estimateCalories(6, 70, 3600), 420);
});

test('smoothSpeeds: 평균을 내고 null 은 유지', () => {
  assert.deepEqual(smoothSpeeds([1, 3, null, 5], 3), [2, 2, null, 5]);
});

test('pairSpeeds: 세그먼트 경계와 시간 없는 지점은 null', () => {
  const pts = [
    { lat: 0, lon: 0, time: 0, seg: 0 },
    { lat: 0, lon: 0.001, time: 10_000, seg: 0 },
    { lat: 0, lon: 0.002, time: 20_000, seg: 1 },
    { lat: 0, lon: 0.003, time: null, seg: 1 },
  ];
  const v = pairSpeeds(pts);
  assert.ok(Math.abs(v[0] - 11.12) < 0.01);
  assert.equal(v[1], null);
  assert.equal(v[2], null);
});
