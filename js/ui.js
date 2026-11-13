// 공용 UI 헬퍼: 토스트, 확인창, 파일 다운로드, 파일 선택

let toastTimer = null;

export function toast(message, { type = 'info', duration = 3200 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, duration);
}

export function confirmDialog(message) {
  return Promise.resolve(window.confirm(message));
}

export function downloadText(filename, text, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 숨김 file input 을 열고 선택된 파일 목록을 반환 */
export function pickFiles({ accept, multiple = false }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.click();
  });
}

/** 파일명에 쓸 수 없는 문자 제거 */
export function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'activity';
}

export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}
