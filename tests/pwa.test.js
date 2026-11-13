// 서비스 워커 사전 캐시 목록이 실제 앱 파일과 일치하는지 검사 (파일 추가 시 누락 방지)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

test('모든 js·css·아이콘 파일이 사전 캐시 목록에 있음', () => {
  const files = ['js', 'css', 'icons'].flatMap((d) => walk(join(ROOT, d))).map((f) => `./${relative(ROOT, f)}`);
  const missing = files.filter((f) => !shell.includes(f));
  assert.deepEqual(missing, [], `sw.js SHELL 에 추가 필요: ${missing.join(', ')}`);
});

test('사전 캐시 목록의 파일이 모두 존재하고 중복이 없음', () => {
  const absent = shell.filter((f) => f !== './' && !existsSync(join(ROOT, f)));
  assert.deepEqual(absent, []);
  assert.equal(new Set(shell).size, shell.length, '중복 항목');
});

test('manifest: 필수 항목과 아이콘 파일', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.scope, './');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  m.icons.forEach((i) => assert.ok(existsSync(join(ROOT, i.src)), i.src));
});
