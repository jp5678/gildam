// 서비스 워커 등록 + 새 버전 안내
// 개발 중(localhost)에는 캐시 혼동을 피하려고 ?sw=1 을 붙였을 때만 등록
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let userRequestedUpdate = false;

function showUpdateBanner(worker) {
  if (document.querySelector('.update-banner')) return;
  const bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>새 버전이 있습니다.</span><button class="btn btn-primary btn-sm">새로고침</button>';
  bar.querySelector('button').addEventListener('click', () => {
    userRequestedUpdate = true;
    worker.postMessage('skipWaiting');
  });
  document.body.append(bar);
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (isLocal && !new URLSearchParams(location.search).has('sw')) return null;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const track = (worker) => {
      worker?.addEventListener('statechange', () => {
        // 기존 버전이 화면을 제어 중일 때만 '새 버전' 안내 (첫 설치는 조용히)
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => track(reg.installing));
    // 첫 설치(clients.claim)에도 controllerchange 가 발생하므로, 사용자가 업데이트를 누른 경우에만 새로고침
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!userRequestedUpdate) return;
      userRequestedUpdate = false;
      location.reload();
    });
    return reg;
  } catch (err) {
    console.error('service worker registration failed', err);
    return null;
  }
}
