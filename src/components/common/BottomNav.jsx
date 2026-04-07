import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function BottomNav() {
  const { isAdmin, isManager } = useAuth();

  return (
    <nav className="bottom-nav">
      <NavLink to="/dashboard" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <span className="bottom-nav-icon">home</span>
        <span>홈</span>
      </NavLink>

      {!isAdmin && (
        <>
          <NavLink to="/attendance" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
            <span className="bottom-nav-icon">edit</span>
            <span>잔업</span>
          </NavLink>
          <NavLink to="/leave" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
            <span className="bottom-nav-icon">cal</span>
            <span>연차</span>
          </NavLink>
        </>
      )}

      {(isAdmin || isManager) && (
        <NavLink to="/manage/overtime" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <span className="bottom-nav-icon">grp</span>
          <span>관리</span>
        </NavLink>
      )}

      {isAdmin && (
        <NavLink to="/admin/users" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <span className="bottom-nav-icon">set</span>
          <span>설정</span>
        </NavLink>
      )}
    </nav>
  );
}
