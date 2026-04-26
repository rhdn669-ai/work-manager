import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const CHECK_INTERVAL_MS = 60 * 1000; // 1분마다 체크

/**
 * 새 버전 배포 감지 시 자동 로그아웃 훅
 * - 1분마다 /version.json 을 서버에서 fetch
 * - 현재 앱 버전(__APP_VERSION__)과 다르면 로그아웃 후 로그인 화면으로 이동
 */
export function useVersionCheck(logout) {
  const navigate = useNavigate();
  const currentVersion = __APP_VERSION__;
  const timerRef = useRef(null);

  useEffect(() => {
    async function checkVersion() {
      try {
        // 캐시 무효화를 위해 타임스탬프 쿼리 추가
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== currentVersion) {
          console.info(`[VersionCheck] 새 버전 감지: ${currentVersion} → ${data.version}. 자동 로그아웃합니다.`);
          // 로그아웃 처리
          if (typeof logout === 'function') logout();
          // 로그인 페이지로 이동 (새로고침으로 최신 파일 로드)
          window.location.href = '/login';
        }
      } catch {
        // 네트워크 오류 등은 조용히 무시
      }
    }

    // 최초 1분 후부터 시작 (앱 로드 직후는 체크 불필요)
    timerRef.current = setInterval(checkVersion, CHECK_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [logout, currentVersion]);
}
