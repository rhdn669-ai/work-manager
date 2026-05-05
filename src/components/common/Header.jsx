import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import UserMenu from './UserMenu';
import SessionTimerBadge from './SessionTimerBadge';
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
      </div>
      <div className="header-right">
        {userProfile && (
          <>
            <SessionTimerBadge />
            <UserMenu />
            <button className="btn btn-sm btn-outline" onClick={handleLogout}>로그아웃</button>
          </>
        )}
      </div>
    </header>
  );
}
