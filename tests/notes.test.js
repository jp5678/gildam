import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NOTE_LENGTH, cleanNoteText, isValidNoteRecord, nearestIndexAtDistance, noteSnippet } from '../js/note-model.js';
import { routeSvg } from '../js/route-svg.js';

const note = { id: 'n1', activityId: 'a1', text: '물 마심', index: 3, method: 'gps', lat: 37.5, lon: 127, time: 1000, createdAt: 1 };

test('cleanNoteText: 공백 정리·길이 제한·빈 메모', () => {
  assert.equal(cleanNoteText('  경치 좋음 \n'), '경치 좋음');
  assert.equal(cleanNoteText('   '), '');
  assert.equal(cleanNoteText(null), '');
  assert.equal(cleanNoteText('가'.repeat(MAX_NOTE_LENGTH + 50)).length, MAX_NOTE_LENGTH);
  assert.equal(cleanNoteText('a\n\n\n\nb'), 'a\n\nb', '빈 줄은 하나까지만');
});

test('isValidNoteRecord: 백업 복원 검증', () => {
  assert.equal(isValidNoteRecord(note), true);
  assert.equal(isValidNoteRecord({ ...note, lat: null, lon: null, time: null }), true);
  assert.equal(isValidNoteRecord({ ...note, id: 'x" onclick="1' }), false);
  assert.equal(isValidNoteRecord({ ...note, activityId: '<b>' }), false);
  assert.equal(isValidNoteRecord({ ...note, text: '' }), false);
  assert.equal(isValidNoteRecord({ ...note, text: 'x'.repeat(MAX_NOTE_LENGTH + 1) }), false);
  assert.equal(isValidNoteRecord({ ...note, index: -1 }), false);
  assert.equal(isValidNoteRecord({ ...note, method: 'magic' }), false);
  assert.equal(isValidNoteRecord(null), false);
});

test('nearestIndexAtDistance: 누적 거리에서 가장 가까운 지점', () => {
  const cum = [0, 100, 250, 400];
  assert.equal(nearestIndexAtDistance(cum, 0), 0);
  assert.equal(nearestIndexAtDistance(cum, 160), 1);
  assert.equal(nearestIndexAtDistance(cum, 200), 2);
  assert.equal(nearestIndexAtDistance(cum, 9999), 3);
  assert.equal(nearestIndexAtDistance([], 10), 0);
});

test('noteSnippet: 한 줄 요약', () => {
  assert.equal(noteSnippet('첫 줄\n둘째 줄'), '첫 줄 둘째 줄');
  assert.equal(noteSnippet('가'.repeat(40), 10), `${'가'.repeat(10)}…`);
});

test('routeSvg: 메모 마커 (id 이스케이프)', () => {
  const pts = [
    { lat: 37.5, lon: 127.0, seg: 0 },
    { lat: 37.51, lon: 127.02, seg: 0 },
  ];
  const svg = routeSvg(pts, { notes: [{ id: 'n"1', index: 1 }] });
  assert.equal((svg.match(/class="svg-note"/g) ?? []).length, 1);
  assert.ok(svg.includes('data-note-id="n&quot;1"'));
  assert.ok(!svg.includes('data-note-id="n"1"'));
});
