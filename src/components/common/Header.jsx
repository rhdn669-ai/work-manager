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

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-toggle" onClick={onToggleSidebar}>☰</button>
        {showBack && (
          <button type="button" className="header-back-btn" onClick={handleBack} aria-label="뒤로 가기">
            ←
          </button>
        )}
        <div className="header-logo" role="img" aria-label="IOPN" />
        <span className="header-version">v{__APP_VERSION__}</span>
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
