// 무활동 자동 로그아웃 공통 설정
// 개발 서버(npm run dev)에서만 만료를 사실상 끈다 — 자동화 검증 중 실제 마우스·키 이벤트가
// 발생하지 않아 30분 뒤 끊기는 문제 회피용. **배포 빌드는 30분 그대로**(import.meta.env.DEV=false).
export const INACTIVITY_TIMEOUT_MS = import.meta.env.DEV ? 365 * 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
export const SESSION_ACTIVITY_KEY = 'workManagerLastActivity';

// 활동 시간을 즉시 갱신해 자동 로그아웃 타이머를 리셋
export function extendSession() {
  try {
    localStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}
