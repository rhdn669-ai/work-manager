import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Sidebar({ isOpen }) {
  const { isAdmin, canApproveLeave } = useAuth();

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard" className="nav-link">홈</NavLink>

        {!isAdmin && (
          <div className="nav-section">
            <NavLink to="/attendance" end className="nav-link">잔업</NavLink>
            <NavLink to="/leave" end className="nav-link">연차</NavLink>
            <NavLink to="/sites" end className="nav-link">프로젝트</NavLink>
          </div>
        )}

        {canApproveLeave && (
          <div className="nav-section">
            <div className="nav-section-title">팀 관리</div>
            <NavLink to="/manage/team" end className="nav-link">팀 구성 현황</NavLink>
            <NavLink to="/manage/leave" end className="nav-link">연차 승인</NavLink>
          </div>
        )}

        {isAdmin && (
          <div className="nav-section">
            <div className="nav-section-title">시스템 관리</div>
            <NavLink to="/admin/users" className="nav-link">직원 관리</NavLink>
            <NavLink to="/admin/leaves" className="nav-link">연차 잔여</NavLink>
            <NavLink to="/admin/sites" className="nav-link">프로젝트 관리</NavLink>
            <NavLink to="/sites" end className="nav-link">마감 리스트</NavLink>
            <NavLink to="/admin/reports" className="nav-link">전사 리포트</NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}
