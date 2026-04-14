import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function BottomNav() {
  const { isAdmin, canApproveLeave } = useAuth();

  return (
    <nav className="bottom-nav">
      <NavLink to="/dashboard" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <svg className="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span>홈</span>
      </NavLink>

      <NavLink to="/attendance" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <svg className="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>잔업</span>
      </NavLink>

      <NavLink to="/leave" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <svg className="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>연차</span>
      </NavLink>

      {(isAdmin || canApproveLeave) && (
        <NavLink to="/sites" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <svg className="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/><path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/></svg>
          <span>프로젝트</span>
        </NavLink>
      )}

      {isAdmin && (
        <NavLink to="/admin/users" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <svg className="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15C8.7 15 6 12.3 6 9V6a6 6 0 0 1 12 0v3c0 3.3-2.7 6-6 6z"/><path d="M2 21c0-3.3 4.5-6 10-6s10 2.7 10 6"/></svg>
          <span>관리</span>
        </NavLink>
      )}
    </nav>
  );
}
