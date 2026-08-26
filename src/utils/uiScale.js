// 화면 배율 — 「보통」과 「크게」.
//
// 글자 크기가 앱 곳곳에 직접 박혀 있어 토큰만 바꿔서는 대부분이 안 따라온다.
// 그래서 브라우저 배율(zoom)로 화면 전체를 키운다 — 글자·여백·버튼이 함께 커지므로
// 누락이 원리적으로 생기지 않고, 글자만 커져 표 칸이 잘리는 일도 없다 (2026-08-26 대표님).
const LS_KEY = 'wmUiScale'; // 로그인 전·새로고침 순간의 깜빡임을 막는 로컬 사본

export function applyUiScale(scale) {
  const v = scale === 'lg' ? 'lg' : 'md';
  document.documentElement.setAttribute('data-ui-scale', v);
  try {
    localStorage.setItem(LS_KEY, v);
  } catch {
    /* 사파리 프라이빗 모드 등 — 저장 못 해도 동작에는 지장 없다 */
  }
}

// 첫 페인트 전에 한 번 — 저장해 둔 크기로 바로 그린다
export function bootUiScale() {
  try {
    applyUiScale(localStorage.getItem(LS_KEY));
  } catch {
    applyUiScale('md');
  }
}
