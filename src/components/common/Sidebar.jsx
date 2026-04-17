import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Sidebar({ isOpen }) {
  const { isAdmin, canApproveLeave } = useAuth();

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard" className="nav-link">홈</NavLink>
        {!isAdmin && <NavLink to="/attendance" end className="nav-link">잔업</NavLink>}
        {!isAdmin && <NavLink to="/leave" end className="nav-link">연차</NavLink>}
        {(isAdmin || canApproveLeave) && <NavLink to="/sites" end className="nav-link">프로젝트</NavLink>}
        {canApproveLeave && <NavLink to="/manage/attendance" end className="nav-link">출퇴근 현황</NavLink>}
        {canApproveLeave && <NavLink to="/manage/team" end className="nav-link">팀 구성 현황</NavLink>}
        {canApproveLeave && <NavLink to="/manage/leave" end className="nav-link">연차 신청 현황</NavLink>}
        {isAdmin && <NavLink to="/admin/users" className="nav-link">직원 관리</NavLink>}
        {isAdmin && <NavLink to="/admin/reports" className="nav-link">직원 현황</NavLink>}
        {isAdmin && <NavLink to="/admin/events" className="nav-link">이벤트 · 공지</NavLink>}
      </nav>
    </aside>
  );
}
