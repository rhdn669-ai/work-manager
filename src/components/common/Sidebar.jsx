import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';

export default function Sidebar({ isOpen }) {
  const { isAdmin, canApproveLeave } = useAuth();
  const { unreadCount } = useChat();

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard" className="nav-link">홈</NavLink>
        {isAdmin && <NavLink to="/admin/users" className="nav-link">직원 관리</NavLink>}
        {isAdmin && <NavLink to="/admin/reports" className="nav-link">잔업 · 연차</NavLink>}
        {!isAdmin && <NavLink to="/attendance" end className="nav-link">잔업</NavLink>}
        {!isAdmin && <NavLink to="/leave" end className="nav-link">연차</NavLink>}
        {(isAdmin || canApproveLeave) && <NavLink to="/sites" end className="nav-link">프로젝트</NavLink>}
        {isAdmin && <NavLink to="/manage/team" end className="nav-link">팀구성 관리</NavLink>}
        {!isAdmin && canApproveLeave && <NavLink to="/manage/team" end className="nav-link">팀 구성 현황</NavLink>}
        {!isAdmin && !canApproveLeave && <NavLink to="/manage/team" end className="nav-link">우리 팀</NavLink>}
        {canApproveLeave && !isAdmin && <NavLink to="/manage/leave" end className="nav-link">팀원 잔업 · 연차</NavLink>}
        <NavLink to="/chat" end className={`nav-link ${unreadCount > 0 ? 'has-unread' : ''}`}>
          채팅
          {unreadCount > 0 && <span className="nav-badge sidebar-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </NavLink>
        {isAdmin && <NavLink to="/admin/events" className="nav-link">이벤트 · 공지</NavLink>}
      </nav>
    </aside>
  );
}
