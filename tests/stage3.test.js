// 날짜 계산은 현지 시간 기준이므로 package.json 의 test 스크립트에서 TZ=Asia/Seoul 로 실행
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey,
  startOfWeek,
  periodStart,
  shiftPeriod,
  periodLabel,
  totals,
  aggregate,
  filterByPeriod,
  dayTotals,
  monthGrid,
  heatLevel,
  bestEffort,
  personalRecords,
} from '../js/stats-math.js';
import { hideHome, remapPhotos, homeHideNotice } from '../js/privacy.js';

const kst = (s) => Date.parse(`${s}+09:00`);
const act = (id, startIso, { type = 'run', distance = 5000, movingTime = 1500, elevationGain = 20, avgSpeed = 3.3, points = [] } = {}) => ({
  id,
  type,
  name: id,
  startTime: kst(startIso),
  points,
  stats: { distance, movingTime, elevationGain, avgSpeed },
});

test('TZ 가 Asia/Seoul 로 설정됨', () => {
  assert.equal(new Date(kst('2026-11-13T00:30:00')).getDate(), 13);
});

test('dayKey / startOfWeek (월요일 시작)', () => {
  assert.equal(dayKey(kst('2026-11-13T23:59:00')), '2026-11-13');
  assert.equal(startOfWeek(kst('2026-11-13T10:00:00')), kst('2026-11-09T00:00:00')); // 금 → 월
  assert.equal(startOfWeek(kst('2026-11-15T10:00:00')), kst('2026-11-09T00:00:00')); // 일 → 같은 주 월
  assert.equal(startOfWeek(kst('2026-11-09T00:00:00')), kst('2026-11-09T00:00:00'));
});

test('periodStart / shiftPeriod / periodLabel', () => {
  const now = kst('2026-11-13T10:00:00');
  assert.equal(periodStart(now, 'month'), kst('2026-11-01T00:00:00'));
  assert.equal(periodStart(now, 'year'), kst('2026-01-01T00:00:00'));
  assert.equal(shiftPeriod(kst('2026-01-01T00:00:00'), 'month', -1), kst('2025-12-01T00:00:00'));
  assert.equal(shiftPeriod(kst('2026-11-09T00:00:00'), 'week', 1), kst('2026-11-16T00:00:00'));
  assert.equal(periodLabel(kst('2026-11-09T00:00:00'), 'week'), '11/9');
  assert.equal(periodLabel(kst('2026-11-01T00:00:00'), 'month'), '11월');
  assert.equal(periodLabel(kst('2026-01-01T00:00:00'), 'year'), '2026');
  assert.throws(() => periodStart(now, 'decade'));
});

test('totals / aggregate (빈 기간 포함, 오래된 순)', () => {
  const list = [act('a', '2026-11-12T07:00:00'), act('b', '2026-11-03T07:00:00', { distance: 3000 }), act('c', '2026-09-20T07:00:00')];
  assert.deepEqual(totals(list), { count: 3, distance: 13000, time: 4500, elevation: 60 });
  const months = aggregate(list, 'month', 3, kst('2026-11-13T10:00:00'));
  assert.deepEqual(months.map((m) => [m.label, m.count, m.distance]), [['9월', 1, 5000], ['10월', 0, 0], ['11월', 2, 8000]]);
  const weeks = aggregate(list, 'week', 2, kst('2026-11-13T10:00:00'));
  assert.deepEqual(weeks.map((w) => w.count), [1, 1]);
});

test('filterByPeriod', () => {
  const list = [act('a', '2026-11-12T07:00:00'), act('b', '2026-11-03T07:00:00'), act('c', '2025-12-31T23:00:00')];
  const now = kst('2026-11-13T10:00:00');
  assert.equal(filterByPeriod(list, 'all', now).length, 3);
  assert.deepEqual(filterByPeriod(list, 'week', now).map((a) => a.id), ['a']);
  assert.deepEqual(filterByPeriod(list, 'month', now).map((a) => a.id), ['a', 'b']);
  assert.deepEqual(filterByPeriod(list, 'year', now).map((a) => a.id), ['a', 'b']);
});

test('dayTotals: 같은 날 합산, 종류 중복 제거', () => {
  const m = dayTotals([act('a', '2026-11-12T07:00:00'), act('b', '2026-11-12T19:00:00', { type: 'walk' }), act('c', '2026-11-12T20:00:00')]);
  assert.deepEqual(m.get('2026-11-12'), { distance: 15000, count: 3, types: ['run', 'walk'] });
});

test('monthGrid: 일요일 시작 — 2026년 11월 1일(일)은 첫 칸, 12월 1일(화)은 앞 2칸 비움', () => {
  const g = monthGrid(2026, 10);
  assert.equal(g[0][0].key, '2026-11-01');
  const dec = monthGrid(2026, 11);
  assert.deepEqual(dec[0].slice(0, 3).map((c) => c?.key ?? null), [null, null, '2026-12-01']);
  assert.equal(g.flat().filter(Boolean).length, 30);
  assert.ok(g.every((w) => w.length === 7));
});

test('heatLevel', () => {
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(1, 10), 1);
  assert.equal(heatLevel(10, 10), 4);
  assert.equal(heatLevel(5, 0), 0);
});

// 동쪽으로 직진, 지점마다 dtSec 초
function track(n, { stepDeg = 0.001, dtSec = 30, seg = () => 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ lat: 0, lon: i * stepDeg, ele: 0, time: i * dtSec * 1000, seg: seg(i) }));
}

test('bestEffort: 일정 속도면 거리/속도 와 같음', () => {
  const pts = track(30); // 111.2m / 30s → 3.706 m/s
  const t = bestEffort(pts, 1000);
  assert.ok(Math.abs(t - 1000 / (111.19 / 30)) < 1, `got ${t}`);
});

test('bestEffort: 빠른 구간을 찾아냄', () => {
  const pts = track(40).map((p, i) => ({ ...p, time: i < 20 ? i * 30_000 : 20 * 30_000 + (i - 20) * 15_000 }));
  const t = bestEffort(pts, 1000);
  assert.ok(Math.abs(t - 1000 / (111.19 / 15)) < 1, `got ${t}`);
});

test('bestEffort: 거리 부족·시간 없음·세그먼트 경계', () => {
  assert.equal(bestEffort(track(5), 1000), null);
  assert.equal(bestEffort([{ lat: 0, lon: 0, time: null, seg: 0 }, { lat: 0, lon: 1, time: null, seg: 0 }], 10), null);
  const split = track(12, { seg: (i) => (i < 6 ? 0 : 1) }); // 각 세그먼트 5 구간(556m)
  assert.equal(bestEffort(split, 1000), null);
});

test('personalRecords', () => {
  const run = act('r', '2026-11-01T07:00:00', { points: track(60) }); // 약 6.6km
  const longRun = act('r2', '2026-11-02T07:00:00', { distance: 21000, movingTime: 7000, points: track(10) });
  const bike = act('b', '2026-11-03T07:00:00', { type: 'bike', distance: 30000, avgSpeed: 7, elevationGain: 300 });
  const car = act('c', '2026-11-04T07:00:00', { type: 'car', distance: 300000, movingTime: 12000, avgSpeed: 25, elevationGain: 900 });
  const recs = Object.fromEntries(personalRecords([run, longRun, bike, car]).map((r) => [r.id, r]));
  // 운동 기록은 자동차를 빼고 계산, 자동차 기록은 따로
  assert.equal(recs.carLongest.activityId, 'c');
  assert.equal(recs.carTime.value, 12000);
  assert.equal(recs.carSpeed.value, 25);
  assert.equal(recs.carLongest.group, 'car');
  assert.equal(recs.longest.group, 'exercise');
  assert.equal(recs.longest.activityId, 'b');
  assert.equal(recs.longestTime.activityId, 'r2');
  assert.equal(recs.climb.value, 300);
  assert.equal(recs.run1k.activityId, 'r');
  assert.equal(recs.run5k.activityId, 'r');
  assert.equal(recs.run10k, undefined);
  assert.equal(recs.bikeSpeed.value, 7);
  assert.deepEqual(personalRecords([]), []);
});

const home = { enabled: true, lat: 0, lon: 0, radius: 300 };

test('hideHome: 집 반경 안 시작·끝을 잘라냄', () => {
  const pts = [...track(10), ...track(10).reverse().map((p, i) => ({ ...p, time: (10 + i) * 30_000 }))]; // 왕복
  const r = hideHome(pts, home);
  assert.equal(r.trimmed, true);
  assert.equal(r.start, 3); // 0, 111, 222m 는 300m 안
  assert.equal(r.end, pts.length - 4);
  assert.equal(r.points.length, pts.length - 6);
  assert.equal(pts.length, 20, '원본 불변');
});

test('hideHome: 꺼져 있거나 위치 없음·전부 안쪽', () => {
  const pts = track(10);
  assert.equal(hideHome(pts, { ...home, enabled: false }).points, pts);
  assert.equal(hideHome(pts, { ...home, lat: null }).trimmed, false);
  assert.equal(hideHome(track(3), { ...home, radius: 5000 }).allHidden, true);
  assert.equal(hideHome(pts, { ...home, lat: 10 }).trimmed, false);
});

test('remapPhotos / homeHideNotice', () => {
  const photos = [{ id: 'a', index: 1 }, { id: 'b', index: 5 }, { id: 'c', index: 9 }];
  assert.deepEqual(remapPhotos(photos, 3, 8), [{ id: 'b', index: 2 }]);
  assert.equal(homeHideNotice({ enabled: false }), null);
  assert.match(homeHideNotice({ enabled: true, lat: null }), /설정되지/);
  assert.match(homeHideNotice(home), /300m/);
});

test('video-export: 확장자·미지원 환경 판별', async () => {
  const { extensionFor, pickMimeType, unsupportedReason, drawOverlay } = await import('../js/video-export.js');
  assert.equal(extensionFor('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionFor('video/webm;codecs=vp9'), 'webm');
  assert.equal(pickMimeType(), null, 'Node 에는 MediaRecorder 가 없음');
  assert.match(unsupportedReason(), /지원하지 않습니다/);
  // 가짜 2D 컨텍스트로 오버레이 그리기 호출 확인 (예외 없이 위치 점·HUD·출처를 그림)
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k in _ ? _[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => ((o[k] = v), true) });
  ctx.measureText = () => ({ width: 10 });
  drawOverlay(ctx, 1000, 600, {
    dot: { x: 100, y: 50, cssWidth: 500, color: '#f00' },
    title: '제목',
    hud: [['1 km', '거리']],
    photo: null,
    attribution: '© OpenStreetMap contributors',
  });
  const arc = calls.find((c) => c[0] === 'arc');
  assert.deepEqual(arc.slice(1, 3), [200, 100], '화면 좌표를 출력 해상도로 확대');
  assert.ok(calls.some((c) => c[0] === 'fillText' && String(c[1]).includes('OpenStreetMap')));
});
