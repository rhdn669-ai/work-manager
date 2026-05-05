// 무활동 자동 로그아웃 공통 설정
export const INACTIVITY_TIMEOUT_MS = 30 * 1000; // 30초 (테스트용)
export const SESSION_ACTIVITY_KEY = 'workManagerLastActivity';

// 활동 시간을 즉시 갱신해 자동 로그아웃 타이머를 리셋
export function extendSession() {
  try { localStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ }
}
