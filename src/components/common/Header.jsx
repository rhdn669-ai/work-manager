import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const HIDE_BACK_PATHS = new Set(['/', '/dashboard']);

export default function Header({ onToggleSidebar }) {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const showBack = !HIDE_BACK_PATHS.has(location.pathname);

  function handleBack() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/dashboard');
    }
  }

  function handleRefresh() {
    window.location.reload();
  }

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-logo" role="img" aria-label="IOPN" />
        <span className="header-version">v{__APP_VERSION__}</span>
        <button className="menu-toggle" onClick={onToggleSidebar}>☰</button>
        {showBack && (
          <button type="button" className="header-back-btn" onClick={handleBack} aria-label="뒤로 가기">
            ←
          </button>
        )}
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
            <span className="user-info">
              {userProfile.name}
              {userProfile.position && (
                <> (<span className={`badge badge-position-${userProfile.position}`}>{userProfile.position}</span>)</>
              )}
            </span>
            <button className="btn btn-sm btn-outline" onClick={handleLogout}>로그아웃</button>
          </>
        )}
      </div>
    </header>
  );
}
