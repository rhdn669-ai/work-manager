import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 60 * 1000;
// 무동작 10초면 자동 reload. 30초였을 땐 계속 작업 중인 사람이 구버전에 오래 머물러,
// 새로 배포한 기능(예: 생산 불량 → 품질보증 연동)이 "안 된다"로 보이는 일이 있었다.
// 입력 포커스 중에는 어차피 보류하므로 타이핑 도중 날아갈 위험은 없다.
const IDLE_THRESHOLD_MS = 10 * 1000;
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000; // 5분 내 재reload 차단 (무한 루프 방지)
const RELOAD_KEY = 'wm_last_auto_reload_ts';

export function useVersionCheck() {
  const currentVersion = __APP_VERSION__;
  const [latestVersion, setLatestVersion] = useState(currentVersion);
  const [latestBuildTime, setLatestBuildTime] = useState(null);
  const intervalRef = useRef(null);
  const inFlightRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));

    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el.isContentEditable === true;
    }

    function canAutoReload() {
      // 사용자 idle 30초 이상
      if (Date.now() - lastActivityRef.current < IDLE_THRESHOLD_MS) return false;
      // 입력 포커스 중이면 보류
      if (isInputFocused()) return false;
      // 5분 내 재reload 차단
      try {
        const last = sessionStorage.getItem(RELOAD_KEY);
        if (last && Date.now() - Number(last) < RELOAD_COOLDOWN_MS) return false;
      } catch {
        /* sessionStorage 접근 실패는 무시 */
      }
      return true;
    }

    async function checkVersion() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.version) return;
        if (data.buildTime) setLatestBuildTime(data.buildTime);
        if (data.version === currentVersion) return;
        setLatestVersion(data.version);
        if (canAutoReload()) {
          try {
            sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          } catch {
            /* 무시 */
          }
          window.location.reload();
        }
      } catch {
        // 네트워크 일시 오류는 무시
      } finally {
        inFlightRef.current = false;
      }
    }

    intervalRef.current = setInterval(checkVersion, CHECK_INTERVAL_MS);

    function onVisible() {
      if (document.visibilityState === 'visible') checkVersion();
    }
    window.addEventListener('focus', checkVersion);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('focus', checkVersion);
      document.removeEventListener('visibilitychange', onVisible);
      activityEvents.forEach((ev) => window.removeEventListener(ev, markActive));
    };
  }, [currentVersion]);

  const hasNewVersion = !!latestVersion && latestVersion !== currentVersion;

  return { hasNewVersion, currentVersion, latestVersion, latestBuildTime };
}
