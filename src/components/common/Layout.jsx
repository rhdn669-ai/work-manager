import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { useAuth } from '../../contexts/AuthContext';
import { useVersionCheck } from '../../hooks/useVersionCheck';

export default function Layout() {
  const { isImpersonating, impersonator, userProfile, stopImpersonation, logout, isAdmin } = useAuth();
  // 사이드바: 관리자만 사용. PC는 기본 열림, 모바일은 기본 닫힘
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 769px)').matches;
  });
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith('/chat');
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  // 모바일에서 라우트 변경 시 사이드바 자동 닫기
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  const [exitToast, setExitToast] = useState(false);
  const exitArmedRef = useRef(false);
  const exitTimerRef = useRef(null);

  // 새 버전 배포 감지 시 자동 로그아웃
  useVersionCheck(logout);

  // 모바일 뒤로가기 두 번 → 앱 종료 (대시보드 루트에서만 작동, iOS 제외)
  // iOS Safari에서는 두 번째 뒤로가기로도 종료 안 되고 이전 사이트로 이동만 하므로 비활성
  useEffect(() => {
    if (location.pathname !== '/dashboard') return;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
    if (isIOS) return;
    // 가드 상태 push — 뒤로가기 시 popstate 이벤트로 가로챔
    window.history.pushState({ exitGuard: true }, '');

    function onPopState() {
      if (exitArmedRef.current) {
        // 두 번째 누름 — 한 단계 더 뒤로가기 = 실제 종료/이전 페이지
        clearTimeout(exitTimerRef.current);
        setExitToast(false);
        exitArmedRef.current = false;
        window.history.back();
        return;
      }
      // 첫 번째 누름 — 토스트 표시 후 가드 재push
      exitArmedRef.current = true;
      setExitToast(true);
      window.history.pushState({ exitGuard: true }, '');
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        exitArmedRef.current = false;
        setExitToast(false);
      }, 2000);
    }

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      clearTimeout(exitTimerRef.current);
      exitArmedRef.current = false;
      setExitToast(false);
    };
  }, [location.pathname]);

  async function handleStopImpersonation() {
    try {
      await stopImpersonation();
      // 페이지가 현재 사용자 역할에 따라 접근 제한된 경우를 대비해 홈으로 이동
      window.location.href = '/';
    } catch (err) {
      alert('오류: ' + err.message);
    }
  }

  // 테스트(개발) 서버 감지 — localhost / 사설 IP에서 접속한 경우
  const isDevHost = (() => {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname;
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      /^192\.168\./.test(h) ||
      /^10\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  })();

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : ''} ${isChatRoute ? 'chat-route' : ''} ${isDevHost ? 'is-dev-host' : ''}`}>
      {isDevHost && (
        <div className="dev-host-banner" role="alert">
          ⚠ 테스트 서버입니다. 여기서 수정하는 내용은 실제 데이터베이스에 반영됩니다.
        </div>
      )}
      {isImpersonating && (
        <div className="impersonation-banner">
          <span className="impersonation-banner-text">
            관리자 <strong>{impersonator?.name}</strong>님이 <strong>{userProfile?.name}</strong>
            {userProfile?.position ? ` (${userProfile.position})` : ''} 계정으로 보는 중
          </span>
          <button type="button" className="impersonation-banner-btn" onClick={handleStopImpersonation}>
            관리자로 돌아가기
          </button>
        </div>
      )}
      <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <div className="app-body">
        {isAdmin && <Sidebar isOpen={sidebarOpen} />}
        {isAdmin && sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <main className={`main-content ${isAdmin && sidebarOpen ? '' : 'expanded'}`}>
          <Outlet />
        </main>
      </div>
      {!isAdmin && <BottomNav />}
      {exitToast && (
        <div className="exit-toast" role="status" aria-live="polite">
          한 번 더 누르면 종료됩니다
        </div>
      )}
    </div>
  );
}
