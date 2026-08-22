// 워크스페이스(업무/생산·품질) 모드 — 로그인 후 선택화면에서 결정, 세션 단위 유지(매번 선택 원칙)
const KEY = 'wmWorkspaceMode'; // 'work' | 'production'

export function getWorkspaceMode() {
  return sessionStorage.getItem(KEY) === 'production' ? 'production' : 'work';
}

export function setWorkspaceMode(mode) {
  sessionStorage.setItem(KEY, mode === 'production' ? 'production' : 'work');
}

// 생산·품질 접근 권한 — 관리자 자동 포함 + 직원관리에서 체크된 직원
export function canProduction(userProfile) {
  return userProfile?.role === 'admin' || !!userProfile?.productionAccess;
}

// 불량 조치 전용 — 현장 공용 아이디용. 호기·판넬별 불량을 보고 조치만 한다.
// 자재 입고·일정·판넬 추가/삭제는 잠긴다 (2026-08-22 대표님).
export function isDefectOnly(userProfile) {
  return userProfile?.role !== 'admin' && !!userProfile?.productionDefectOnly;
}

// 생산현황에 들어올 수 있는가 — 생산·품질 권한자 또는 불량 조치 전용 계정
export function canEnterProduction(userProfile) {
  return canProduction(userProfile) || isDefectOnly(userProfile);
}
