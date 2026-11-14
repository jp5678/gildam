import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExifDate, nearestPointIndex, indexAtTime, matchPhoto, isValidPhotoRecord, placeLivePhoto } from '../js/photo-match.js';
import { bearing, lerpAngle, baseDurationSec, createTrack } from '../js/replay-math.js';

const T0 = Date.UTC(2026, 9, 11, 0, 0, 0); // 09:00 KST
const route = Array.from({ length: 11 }, (_, i) => ({ lat: 37.5, lon: 127 + i * 0.001, ele: 100 + i * 10, time: T0 + i * 60_000, seg: 0 }));

test('parseExifDate: 오프셋이 있으면 그것을 사용', () => {
  assert.equal(parseExifDate('2026:10:11 09:05:00', '+09:00', 0), T0 + 5 * 60_000);
  assert.equal(parseExifDate('2026:10:11 00:05:00', '-00:00', 540), T0 + 5 * 60_000);
});

test('parseExifDate: 오프셋이 없으면 기기 시간대 사용', () => {
  assert.equal(parseExifDate('2026:10:11 09:05:00', null, 540), T0 + 5 * 60_000);
  assert.equal(parseExifDate('2026-10-11T09:05:00', undefined, 540), T0 + 5 * 60_000);
});

test('parseExifDate: 잘못된 값', () => {
  assert.equal(parseExifDate('garbage', null, 0), null);
  assert.equal(parseExifDate(null, null, 0), null);
});

test('nearestPointIndex / indexAtTime', () => {
  assert.equal(nearestPointIndex(route, 37.5001, 127.0042).index, 4);
  assert.equal(indexAtTime(route, T0 + 3.4 * 60_000), 3);
  assert.equal(indexAtTime(route, T0 + 3.6 * 60_000), 4);
  assert.equal(indexAtTime(route, T0 - 1e6), 0);
  assert.equal(indexAtTime(route, T0 + 1e9), 10);
});

test('matchPhoto: GPS 우선', () => {
  const r = matchPhoto({ lat: 37.5, lon: 127.0071, time: T0 }, route);
  assert.equal(r.ok, true);
  assert.equal(r.method, 'gps');
  assert.equal(r.index, 7);
});

test('matchPhoto: GPS 가 경로에서 멀면 시각으로 대체', () => {
  const r = matchPhoto({ lat: 38, lon: 127, time: T0 + 2 * 60_000 }, route);
  assert.deepEqual([r.ok, r.method, r.index], [true, 'time', 2]);
});

test('matchPhoto: GPS 없고 시각만', () => {
  const r = matchPhoto({ lat: null, lon: null, time: T0 + 9 * 60_000 }, route);
  assert.deepEqual([r.ok, r.method, r.index], [true, 'time', 9]);
});

test('matchPhoto: 실패 사유', () => {
  assert.match(matchPhoto({ lat: null, lon: null, time: T0 + 86_400_000 }, route).reason, /활동 시간 밖/);
  assert.match(matchPhoto({ lat: null, lon: null, time: null }, route).reason, /EXIF/);
  assert.match(matchPhoto({ lat: 38, lon: 127, time: null }, route).reason, /1km/);
  assert.match(matchPhoto({ lat: 38, lon: 127, time: T0 + 86_400_000 }, route).reason, /멀고/);
  assert.equal(matchPhoto({ lat: 1, lon: 1, time: 1 }, []).ok, false);
});

test('bearing: 동쪽 90°, 북쪽 0°', () => {
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 1e-6);
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) < 1e-6);
});

test('lerpAngle: 350° → 10° 는 0° 를 지나는 짧은 방향', () => {
  assert.ok(Math.abs(lerpAngle(350, 10, 0.5) - 0) < 1e-9 || Math.abs(lerpAngle(350, 10, 0.5) - 360) < 1e-9);
  assert.ok(Math.abs(lerpAngle(10, 350, 0.5)) < 1e-9 || Math.abs(lerpAngle(10, 350, 0.5) - 360) < 1e-9);
  assert.equal(lerpAngle(0, 90, 1), 90);
});

test('baseDurationSec: 30~120초 범위', () => {
  assert.equal(baseDurationSec(1000), 30);
  assert.equal(baseDurationSec(10_000), 60);
  assert.equal(baseDurationSec(100_000), 120);
});

test('createTrack: 진행률 보간', () => {
  const tr = createTrack(route);
  const mid = tr.at(0.5);
  assert.ok(Math.abs(mid.lon - 127.005) < 1e-6);
  assert.ok(Math.abs(mid.ele - 150) < 1e-6);
  assert.ok(Math.abs(mid.time - (T0 + 5 * 60_000)) < 1);
  assert.equal(tr.at(0).index, 0);
  assert.equal(tr.at(1).index, 10);
  assert.ok(Math.abs(tr.at(2).distance - tr.total) < 1e-6, '범위 밖은 끝으로 고정');
  assert.ok(Math.abs(tr.fractionOfIndex(5) - 0.5) < 1e-9);
  assert.ok(Math.abs(tr.headingAt(0.2, 100) - 90) < 0.1);
  assert.ok(Math.abs(tr.headingAt(1, 100) - 90) < 0.1, '끝에서는 뒤쪽 기준 방향');
});

test('createTrack: 지점 하나', () => {
  const tr = createTrack([route[0]]);
  assert.equal(tr.at(0.5).lat, 37.5);
});

test('isValidPhotoRecord', () => {
  const ok = { id: 'p1', activityId: 'a1', index: 3, method: 'gps', lat: 37, lon: 127, time: T0, blob: 'data:image/jpeg;base64,AA', thumb: 'data:image/jpeg;base64,AA' };
  assert.equal(isValidPhotoRecord(ok), true);
  assert.equal(isValidPhotoRecord({ ...ok, lat: null, lon: null }), true);
  assert.equal(isValidPhotoRecord({ ...ok, index: -1 }), false);
  assert.equal(isValidPhotoRecord({ ...ok, method: 'magic' }), false);
  assert.equal(isValidPhotoRecord({ ...ok, blob: 42 }), false);
  assert.equal(isValidPhotoRecord(null), false);
  assert.equal(isValidPhotoRecord({ ...ok, id: "p1' onclick='x" }), false, '위험한 id 거부');
  assert.equal(isValidPhotoRecord({ ...ok, activityId: '<a>' }), false);
});

test('placeLivePhoto: 기록 중 사진은 항상 경로 위에 배치', () => {
  assert.deepEqual(placeLivePhoto({ lat: 37.5, lon: 127.0071, time: T0 }, route), { index: 7, method: 'gps' });
  assert.deepEqual(placeLivePhoto({ lat: null, lon: null, time: T0 + 4 * 60_000 }, route), { index: 4, method: 'time' });
  // 위치 실패·시각 범위 밖이어도 가장 가까운 시각 지점(끝)
  assert.deepEqual(placeLivePhoto({ lat: 38, lon: 127, time: T0 + 86_400_000 }, route), { index: 10, method: 'time' });
  assert.deepEqual(placeLivePhoto({ lat: null, lon: null, time: null }, route), { index: 10, method: 'time' });
});
