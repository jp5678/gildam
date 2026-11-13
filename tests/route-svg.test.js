import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjector, routeSvg } from '../js/route-svg.js';

const pts = [
  { lat: 37.5, lon: 127.0, seg: 0 },
  { lat: 37.51, lon: 127.02, seg: 0 },
];

test('makeProjector: 경로가 패딩 안쪽에 들어오고 북쪽이 위', () => {
  const p = makeProjector(pts, 1000, 40);
  const [x0, y0] = p(pts[0]);
  const [x1, y1] = p(pts[1]);
  for (const v of [x0, y0, x1, y1]) assert.ok(v >= 39.9 && v <= 960.1, `out of range ${v}`);
  assert.ok(y1 < y0, '북쪽 지점은 위(작은 y)');
  assert.ok(x1 > x0);
});

test('makeProjector: 한 점에 몰린 경로도 NaN 없이 처리', () => {
  const p = makeProjector([pts[0], { ...pts[0] }]);
  assert.ok(p(pts[0]).every(Number.isFinite));
});

test('routeSvg: 색상 피처와 시작/종료 원', () => {
  const svg = routeSvg(pts, {
    features: [{ properties: { color: '#ff0000' }, geometry: { coordinates: [[127.0, 37.5], [127.02, 37.51]] } }],
  });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('stroke="#ff0000"'));
  assert.equal((svg.match(/<circle/g) ?? []).length, 2);
  assert.equal(routeSvg([pts[0]]), '');
});
