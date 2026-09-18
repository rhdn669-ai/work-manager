// 「마우스로 쓰는 PC 인가」 — 잠금 단추를 보일지 정하는 기준.
//
// 잠금은 태블릿에서 표를 스치다 실수로 옮기고 지우는 걸 막으려고 둔 것이다. 마우스로 쓰는
// PC 에서는 그럴 일이 없어 매번 풀기만 하는 군더더기였다 (2026-09-18 대표님 「pc 에서는 잠금버튼
// 없애자」). 화면 폭으로 가르면 안 된다 — 대표님 태블릿(1340px)이 PC 로 잡힌다. 손가락(coarse)과
// 마우스(fine)를 가르는 것이 맞다.
export function isFinePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
