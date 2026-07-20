import { useAuth } from '../../contexts/useAuth';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import UserMenu from './UserMenu';
import { canProduction } from '../../utils/workspace';
import Icon from './Icon';
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
          <button className="menu-toggle" onClick={onToggleSidebar} aria-label="메뉴">
            <Icon name="list" />
          </button>
        )}
        <div className="header-brand" style={{ marginLeft: 10 }}>
          <img src="/icnp-emblem.png" className="header-logo" alt="IOPN" draggable="false" />
        </div>
        <span className="header-version" title={new Date(__APP_BUILD_TIME__).toLocaleString('ko-KR')}>
          <span className="header-version-num">v{__APP_VERSION__}</span>
          {buildRel && <span className="header-version-rel">{buildRel}</span>}
        </span>
      </div>
      <div className="header-right">
        {userProfile && (
          <>
            <UserMenu />
            {canProduction(userProfile) && (
              <button
                className="btn btn-sm btn-outline"
                onClick={() => {
                  window.location.href = '/workspace';
                }}
                title="업무/생산 모드 전환"
              >
                모드
              </button>
            )}
            <button className="btn btn-sm btn-outline" onClick={handleLogout}>
              로그아웃
            </button>
          </>
        )}
      </div>
    </header>
  );
}
