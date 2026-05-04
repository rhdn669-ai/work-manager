import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import UserMenu from './UserMenu';
import { formatRelativeKo } from '../../utils/dateUtils';

export default function Header({ onToggleSidebar }) {
  const { userProfile, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  // 1분마다 상대 시간 갱신
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const buildRel = formatRelativeKo(__APP_BUILD_TIME__);

  function handleRefresh() {
    window.location.reload();
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <header className="header">
      <div className="header-left">
        {isAdmin && (
          <button className="menu-toggle" onClick={onToggleSidebar} aria-label="메뉴">☰</button>
        )}
        <div className="header-logo" role="img" aria-label="IOPN" />
        <span className="header-version" title={new Date(__APP_BUILD_TIME__).toLocaleString('ko-KR')}>
          <span className="header-version-num">v{__APP_VERSION__}</span>
          {buildRel && <span className="header-version-rel">{buildRel}</span>}
        </span>
        <button type="button" className="header-refresh-btn" onClick={handleRefresh} aria-label="새로고침">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      <div className="header-right">
        {userProfile && (
          <>
            <UserMenu />
            <button className="btn btn-sm btn-outline" onClick={handleLogout}>로그아웃</button>
          </>
        )}
      </div>
    </header>
  );
}
