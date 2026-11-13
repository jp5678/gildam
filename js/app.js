// 앱 진입점: 해시 라우터 + 하단 탭
import { applyTheme } from './settings-store.js';
import { toast } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const ROUTES = [
  { pattern: /^#\/record$/, tab: 'record', load: () => import('./views/record.js') },
  { pattern: /^#\/archive$/, tab: 'archive', load: () => import('./views/archive.js') },
  { pattern: /^#\/activity\/([\w-]+)$/, tab: 'archive', keys: ['id'], load: () => import('./views/detail.js') },
  { pattern: /^#\/replay\/([\w-]+)$/, tab: 'archive', keys: ['id'], load: () => import('./views/replay.js') },
  { pattern: /^#\/stats$/, tab: 'stats', load: () => import('./views/stats.js') },
  { pattern: /^#\/settings$/, tab: 'settings', load: () => import('./views/settings.js') },
];

const main = document.getElementById('main');
let cleanup = null;
let renderToken = 0;

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const hash = location.hash || '#/record';
  const match = ROUTES.map((r) => ({ r, m: hash.match(r.pattern) })).find((x) => x.m);
  if (!match) return navigate('#/record');
  const { r, m } = match;
  const params = Object.fromEntries((r.keys ?? []).map((k, i) => [k, decodeURIComponent(m[i + 1])]));

  const token = ++renderToken;
  try {
    cleanup?.();
  } catch (err) {
    console.error('view cleanup failed', err);
  }
  cleanup = null;
  document.querySelectorAll('.tabbar a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === r.tab));

  // 각 렌더는 독립된 컨테이너에 그려서 이전 화면의 이벤트 리스너가 남지 않게 함
  const container = document.createElement('div');
  container.className = 'view-container';
  main.replaceChildren(container);
  try {
    const mod = await r.load();
    const result = await mod.render(container, { params, navigate });
    const dispose = typeof result === 'function' ? result : null;
    if (token !== renderToken) return dispose?.(); // 렌더 도중 다른 화면으로 이동한 경우
    cleanup = dispose;
    main.scrollTo?.(0, 0);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<section class="view"><p class="error">화면을 불러오지 못했습니다. 네트워크 연결을 확인하고 새로고침해 주세요.</p></section>';
    toast(err?.message ?? String(err), { type: 'error' });
  }
}

applyTheme();
window.addEventListener('hashchange', route);
route();
registerServiceWorker();
