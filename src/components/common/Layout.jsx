import { useState, useEffect, useRef, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { probeFirestore, resetLocalCacheAndReload } from '../../utils/firestoreWatchdog';
import Header from './Header';
import Sidebar from './Sidebar';
import { isDefectOnly } from '../../utils/workspace';
import { getCardLibrary } from '../../services/fileLibraryService';
import { setLibraryCards } from '../../utils/mailTemplate';
import BottomNav from './BottomNav';
import { ensureBodyScrollUnlockedIfIdle } from './bodyScrollLock';
import HintReminderBanner from './HintReminderBanner';
import VehicleMileageModal from './VehicleMileageModal';
import { useAuth } from '../../contexts/useAuth';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { getMileage } from '../../services/vehicleMileageService';
import { formatRelativeKo } from '../../utils/dateUtils';
import { useDialog } from './useDialog';
import { installFitTables, fitTables } from '../../utils/fitTables';

export default function Layout() {
  const { isImpersonating, impersonator, userProfile, stopImpersonation, isAdmin } = useAuth();
  const { alert } = useDialog();
  // 현장 공용 아이디 — 생산현황 한 화면만 쓰므로 사이드바·하단탭이 필요 없다 (2026-08-22 대표님)
  const defectOnly = isDefectOnly(userProfile);
  // 사이드바: 관리자만 사용. PC는 기본 열림, 모바일은 기본 닫힘
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 769px)').matches;
  });
  const location = useLocation();
  // 긴 표의 상자 높이를 화면에 맞춘다 — 가로 스크롤바가 늘 보이게 (2026-09-04 대표님)
  useEffect(() => installFitTables(), []);
  useEffect(() => {
    const t = setTimeout(fitTables, 300); // 화면 전환 직후 표가 그려질 시간
    return () => clearTimeout(t);
  }, [location.pathname]);
  const navigate = useNavigate();
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  // 마우스 옆 버튼(뒤로 4번 / 앞으로 5번) → 이전·다음 화면으로 이동.
  // 브라우저 기본 뒤로가기와 이중 이동하지 않도록 preventDefault로 차단하고 SPA 라우팅으로 처리.
  // (설치형 PWA처럼 주소창이 없는 창에서도 동일하게 동작)
  // 자료실 「명함」 폴더를 한 번 읽어 둔다 — 메일 보낼 때마다 조회하면 느리다.
  // 올리자마자 쓰려면 새로고침이 필요하지만, 명함은 자주 바뀌지 않는다.
  useEffect(() => {
    getCardLibrary()
      .then(setLibraryCards)
      .catch(() => {}); // 못 읽어도 붙박이 명함으로 나간다
  }, []);

  useEffect(() => {
    const suppress = (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    const onMouseUp = (e) => {
      if (e.button === 3) {
        e.preventDefault();
        navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener('mousedown', suppress);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', suppress);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [navigate]);

  // 모바일에서 라우트 변경 시 사이드바 자동 닫기 + 스크롤 잠금 잔재 자동 해제
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
    ensureBodyScrollUnlockedIfIdle(); // 모달 잠금이 남아 세로 스크롤이 막힌 경우 복구
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // 자가복구 안전망 — 열린 모달이 없는데 스크롤 잠금이 잔류하면, 사용자가 화면을
  // 만지거나(터치/포인터) 앱으로 돌아오는 순간 즉시 해제. (일부 기기에서 세로 스크롤이
  // 막힌 채로 남던 문제를 새로고침 없이 그 자리에서 회복)
  useEffect(() => {
    const heal = () => ensureBodyScrollUnlockedIfIdle();
    window.addEventListener('focus', heal);
    window.addEventListener('pageshow', heal);
    document.addEventListener('visibilitychange', heal);
    document.addEventListener('touchstart', heal, { passive: true });
    document.addEventListener('pointerdown', heal, { passive: true });
    return () => {
      window.removeEventListener('focus', heal);
      window.removeEventListener('pageshow', heal);
      document.removeEventListener('visibilitychange', heal);
      document.removeEventListener('touchstart', heal);
      document.removeEventListener('pointerdown', heal);
    };
  }, []);
  const [exitToast, setExitToast] = useState(false);
  // 데이터가 영영 안 올 때 — 로컬 캐시 초기화 안내 (2026-09-05 대표님 「이 상태에서 자꾸 머무는데」)
  const [dataStuck, setDataStuck] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      probeFirestore().then((r) => {
        if (alive && r === 'stuck') setDataStuck(true);
      });
    }, 4000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
  const exitArmedRef = useRef(false);
  const exitTimerRef = useRef(null);

  // 새 버전 배포 감지 — 토스트로 알림 후 사용자가 새로고침
  const { hasNewVersion, latestVersion, latestBuildTime } = useVersionCheck();

  // 차량 운행자 — 이번달 키로수 미입력 시 자동 안내 모달 (1회 체크 / 로그인당 1회)
  // 자동 안내 시작일 — 이 날짜 이전에는 자동 모달이 뜨지 않음 (수동 메뉴 입력은 항상 가능)
  const VEHICLE_PROMPT_START_DATE = '2026-05-01';
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const vehicleCheckedRef = useRef(false);
  useEffect(() => {
    if (!userProfile?.uid || !userProfile?.usesVehicle) return;
    if (vehicleCheckedRef.current) return;
    vehicleCheckedRef.current = true;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (today < VEHICLE_PROMPT_START_DATE) return;
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    getMileage(userProfile.uid, y, m)
      .then((rec) => {
        if (!rec) setVehicleModalOpen(true);
      })
      .catch(() => {
        /* 무시 — 다음 로그인 때 재확인 */
      });
  }, [userProfile?.uid, userProfile?.usesVehicle]);

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

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
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
        {/* 사이드바 표시 조건:
            - 관리자: 항상 (PC는 기본 열림, 모바일은 햄버거로 토글)
            - 비관리자 PC: 항상 (BottomNav 대용)
            - 비관리자 모바일: 미표시 (BottomNav만 사용) */}
        {!defectOnly && (isAdmin || !isMobile) && <Sidebar isOpen={sidebarOpen} />}
        {isAdmin && isMobile && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        )}
        <main className={`main-content ${!defectOnly && (isAdmin || !isMobile) && sidebarOpen ? '' : 'expanded'}`}>
          {/* 힌트 설정 안내 배너 — 고정 헤더 아래 보이는 영역 안에서 렌더(헤더 뒤에 가려져
              빈 공간을 만들던 문제 수정). 힌트 미설정 계정에만 노출. */}
          <HintReminderBanner />
          <Suspense fallback={<div className="loading">로딩 중...</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      {!isAdmin && !defectOnly && <BottomNav />}
      {exitToast && (
        <div className="exit-toast" role="status" aria-live="polite">
          한 번 더 누르면 종료됩니다
        </div>
      )}
      {/* 데이터가 영영 안 올 때 — 로컬 캐시 초기화 안내 (2026-09-05 대표님) */}
      {dataStuck && (
        <div className="update-toast is-stuck" role="alert">
          <span className="update-toast-text">데이터를 못 받아 오고 있습니다 — 저장된 캐시가 꼬였을 수 있습니다</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={resetLocalCacheAndReload}>
            초기화 후 다시 열기
          </button>
        </div>
      )}
      {hasNewVersion && (
        <div className="update-toast" role="status" aria-live="polite">
          <span className="update-toast-text">
            새 버전(v{latestVersion}) 배포됨
            {latestBuildTime && <span className="update-toast-rel"> · {formatRelativeKo(latestBuildTime)}</span>}
          </span>
          <button type="button" className="update-toast-btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      )}
      <VehicleMileageModal
        isOpen={vehicleModalOpen}
        onClose={() => setVehicleModalOpen(false)}
        onSaved={() => setVehicleModalOpen(false)}
      />
    </div>
  );
}
