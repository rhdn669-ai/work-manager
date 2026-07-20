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
