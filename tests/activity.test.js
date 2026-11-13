import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivity, updateActivity, isValidActivity } from '../js/activity.js';
import { normalizeType, guessType, getType, usesSpeed, exerciseOnly } from '../js/activity-types.js';
import { formatDistance, formatDuration, formatPace, formatSpeed, esc, defaultActivityName } from '../js/format.js';
import { toGpx, escapeXml } from '../js/gpx.js';

const T0 = Date.UTC(2026, 9, 3, 0, 0, 0); // 2026-10-03 09:00 KST

function track(n, { stepDeg = 0.0001, dtSec = 5, seg = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ lat: 37.5, lon: 127 + i * stepDeg, ele: 50, time: T0 + i * dtSec * 1000, seg }));
}

test('buildActivity: 기본 이름과 통계', () => {
  const a = buildActivity({ id: 'a1', now: T0, points: track(50), type: 'run', source: 'gps', weightKg: 60 });
  assert.equal(a.type, 'run');
  assert.match(a.name, /달리기$/);
  assert.equal(a.startTime, T0);
  assert.ok(a.stats.distance > 400);
  assert.ok(a.stats.calories > 0);
});

test('buildActivity: 종류 미지정이면 속도로 추정 (약 1.8m/s → 걷기)', () => {
  const a = buildActivity({ id: 'a2', now: T0, points: track(30), source: 'gpx', weightKg: 60 });
  assert.equal(a.type, 'walk');
});

test('buildActivity: 가져오기 시 속도 필터 적용', () => {
  const pts = track(30);
  const withSpike = pts.map((p, i) => (i === 15 ? { ...p, lat: p.lat + 0.01 } : p));
  const a = buildActivity({ id: 'a3', now: T0, points: withSpike, type: 'run', source: 'gpx', weightKg: 60, applySpeedFilter: true });
  assert.equal(a.filteredCount, 1);
  assert.equal(a.points.length, 29);
});

test('buildActivity: 이름 길이 제한과 불필요 필드 제거', () => {
  const pts = track(5).map((p) => ({ ...p, acc: 5, extra: 'x' }));
  const a = buildActivity({ id: 'a4', now: T0, points: pts, type: 'hike', name: 'x'.repeat(200), source: 'gps', weightKg: 60 });
  assert.equal(a.name.length, 80);
  assert.deepEqual(Object.keys(a.points[0]).sort(), ['ele', 'lat', 'lon', 'seg', 'time']);
});

test('updateActivity: 새 객체를 반환하고 칼로리 재계산', () => {
  const a = buildActivity({ id: 'a5', now: T0, points: track(50), type: 'walk', source: 'gps', weightKg: 60 });
  const b = updateActivity(a, { type: 'run', name: '  새 이름 ' }, 60);
  assert.notEqual(a, b);
  assert.equal(a.type, 'walk');
  assert.equal(b.type, 'run');
  assert.equal(b.name, '새 이름');
  assert.ok(b.stats.calories > a.stats.calories);
  assert.equal(updateActivity(a, { type: 'bogus', name: '' }, 60).type, 'walk');
});

test('isValidActivity', () => {
  const a = buildActivity({ id: 'a6', now: T0, points: track(5), type: 'bike', source: 'gps', weightKg: 60 });
  assert.equal(isValidActivity(a), true);
  assert.equal(isValidActivity({ ...a, type: 'swim' }), false);
  assert.equal(isValidActivity({ ...a, points: [{ lat: 100, lon: 0 }, { lat: 0, lon: 0 }] }), false);
  assert.equal(isValidActivity(null), false);
});

test('normalizeType / guessType / getType', () => {
  assert.equal(normalizeType('running'), 'run');
  assert.equal(normalizeType('Biking'), 'bike');
  assert.equal(normalizeType('hiking'), 'hike');
  assert.equal(normalizeType('Walking'), 'walk');
  assert.equal(normalizeType(undefined), null);
  assert.equal(guessType({ avgSpeed: 6, elevationGain: 0, distance: 1000 }), 'bike');
  assert.equal(guessType({ avgSpeed: 1, elevationGain: 500, distance: 5000 }), 'hike');
  assert.equal(guessType({ avgSpeed: 3, elevationGain: 0, distance: 5000 }), 'run');
  assert.equal(getType('nope').id, 'walk');
});

test('자동차 종류', () => {
  assert.equal(normalizeType('driving'), 'car');
  assert.equal(normalizeType('Car'), 'car');
  assert.equal(normalizeType('자동차'), 'car');
  assert.equal(normalizeType('cardio'), null, "'cardio' 는 자동차가 아님");
  assert.equal(guessType({ avgSpeed: 15, elevationGain: 0, distance: 50000 }), 'car');
  assert.equal(usesSpeed('car'), true);
  assert.equal(usesSpeed('bike'), true);
  assert.equal(usesSpeed('run'), false);
  assert.deepEqual(exerciseOnly([{ type: 'car' }, { type: 'walk' }]).map((a) => a.type), ['walk']);
  const a = buildActivity({ id: 'c1', now: T0, points: track(30, { stepDeg: 0.002, dtSec: 5 }), type: 'car', source: 'gps', weightKg: 60 });
  assert.equal(a.stats.calories, 0);
  assert.equal(isValidActivity(a), true);
});

test('format 함수', () => {
  assert.equal(formatDistance(5234), '5.23 km');
  assert.equal(formatDistance(850.4), '850 m');
  assert.equal(formatDistance(NaN), '-');
  assert.equal(formatDuration(3909), '1:05:09');
  assert.equal(formatDuration(309), '5:09');
  assert.equal(formatPace(332), `5'32"`);
  assert.equal(formatPace(null), '-');
  assert.equal(formatSpeed(10), '36.0 km/h');
  assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.match(defaultActivityName(T0, '등산'), /등산$/);
});

test('toGpx: 세그먼트 분리, 이스케이프, 좌표 정밀도', () => {
  const pts = [...track(2), ...track(2, { seg: 1 })];
  const xml = toGpx({ name: 'A&B <산>', type: 'hike', points: pts });
  assert.equal((xml.match(/<trkseg>/g) ?? []).length, 2);
  assert.ok(xml.includes('A&amp;B &lt;산&gt;'));
  assert.ok(xml.includes('lat="37.5000000"'));
  assert.ok(xml.includes('<time>2026-10-03T00:00:00.000Z</time>'));
  assert.equal(escapeXml(`'"`), '&apos;&quot;');
});

test('toGpx: 고도·시간 없는 지점', () => {
  const xml = toGpx({ name: 'x', type: 'walk', points: [{ lat: 1, lon: 2, ele: null, time: null, seg: 0 }] });
  assert.ok(xml.includes('<trkpt lat="1.0000000" lon="2.0000000"></trkpt>'));
});
