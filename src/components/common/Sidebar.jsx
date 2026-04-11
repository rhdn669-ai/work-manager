import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Sidebar({ isOpen }) {
  const { isAdmin, isManager } = useAuth();

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard" className="nav-link">대시보드</NavLink>

        <div className="nav-section">
          <div className="nav-section-title">업무</div>
          <NavLink to="/attendance" end className="nav-link">잔업</NavLink>
          <NavLink to="/leave" end className="nav-link">연차</NavLink>
          <NavLink to="/sites" end className="nav-link">현장</NavLink>
        </div>

        {(isAdmin || isManager) && (
          <div className="nav-section">
            <div className="nav-section-title">부서 관리</div>
            <NavLink to="/manage/overtime" className="nav-link">부서원 잔업</NavLink>
            <NavLink to="/manage/leave" end className="nav-link">연차 승인</NavLink>
          </div>
        )}

        {isAdmin && (
          <div className="nav-section">
            <div className="nav-section-title">시스템 관리</div>
            <NavLink to="/admin/users" className="nav-link">사용자 관리</NavLink>
            <NavLink to="/admin/departments" className="nav-link">부서 관리</NavLink>
            <NavLink to="/admin/leaves" className="nav-link">연차 관리</NavLink>
            <NavLink to="/admin/sites" className="nav-link">현장 관리</NavLink>
            <NavLink to="/admin/reports" className="nav-link">전사 리포트</NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}
