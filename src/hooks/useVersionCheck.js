import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 60 * 1000;

export function useVersionCheck() {
  const currentVersion = __APP_VERSION__;
  const [latestVersion, setLatestVersion] = useState(currentVersion);
  const intervalRef = useRef(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function checkVersion() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.version) {
          setLatestVersion(data.version);
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
    };
  }, []);

  const hasNewVersion = !!latestVersion && latestVersion !== currentVersion;

  return { hasNewVersion, currentVersion, latestVersion };
}
