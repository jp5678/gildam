// 통계 탭 — 3단계에서 구현 예정 (누적 차트, 캘린더 히트맵, 개인 최고 기록)
export function render(root) {
  root.innerHTML = `
  <section class="view">
    <header class="view-header"><h1>통계</h1></header>
    <div class="empty">
      <p>📊 통계는 3단계에서 제공됩니다.</p>
      <p class="muted">주/월/연 누적 거리·시간, 월별 캘린더 히트맵, 개인 최고 기록이 이곳에 표시됩니다.</p>
    </div>
  </section>`;
}
