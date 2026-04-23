import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';

const Item = ({ to, end, label, badge, children }) => (
  <NavLink to={to} end={end} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
    <div className={`bottom-nav-icon-wrap ${badge > 0 ? 'has-badge' : ''}`}>
      <svg className="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{children}</svg>
      {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </div>
    <span>{label}</span>
  </NavLink>
);

export default function BottomNav() {
  const { isAdmin, canApproveLeave } = useAuth();
  const { unreadCount } = useChat();

  return (
    <nav className="bottom-nav">
      {/* 1. 홈 */}
      <Item to="/dashboard" end label="홈">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </Item>

      {/* 2. 직원 관리 (관리자) */}
      {isAdmin && (
        <Item to="/admin/users" label="직원 관리">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </Item>
      )}

      {/* 2-3. 잔업 / 연차 (일반 직원) */}
      {!isAdmin && (
        <Item to="/attendance" end label="잔업">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </Item>
      )}
      {!isAdmin && (
        <Item to="/leave" end label="연차">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </Item>
      )}

      {/* 3. 잔업 · 연차 (관리자) */}
      {isAdmin && (
        <Item to="/admin/reports" label="잔업 · 연차">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </Item>
      )}

      {/* 4. 프로젝트 (관리자·팀장) */}
      {(isAdmin || canApproveLeave) && (
        <Item to="/sites" end label="프로젝트">
          <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/>
          <path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/>
          <path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/>
        </Item>
      )}

      {/* 4-1. 팀구성 관리 (관리자) */}
      {isAdmin && (
        <Item to="/manage/team" end label="팀구성">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </Item>
      )}

      {/* 5. 우리 팀 (팀장 → 잔업·연차, 일반 → 팀 구성) */}
      {canApproveLeave && !isAdmin && (
        <Item to="/manage/leave" end label="우리 팀">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </Item>
      )}
      {!isAdmin && !canApproveLeave && (
        <Item to="/manage/team" end label="우리 팀">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </Item>
      )}

      {/* 7. 채팅 (전체) */}
      <Item to="/chat" end label="채팅" badge={unreadCount}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </Item>

      {/* 7. 이벤트 · 공지 (관리자) */}
      {isAdmin && (
        <Item to="/admin/events" label="이벤트·공지">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </Item>
      )}
    </nav>
  );
}
