import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Header({ onToggleSidebar }) {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-toggle" onClick={onToggleSidebar}>☰</button>
        <div className="header-logo" role="img" aria-label="IOPN" />
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
