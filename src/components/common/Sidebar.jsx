import { useState, useMemo, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';

const LS_KEY = 'sidebar-order-v1';

// 기본 순서대로 모든 메뉴 정의
function buildAllItems({ isAdmin, canApproveLeave, unreadCount }) {
  return [
    { key: 'home', to: '/dashboard', label: '홈', show: true, end: false },
    { key: 'admin-users', to: '/admin/users', label: '직원 관리', show: isAdmin },
    { key: 'admin-reports', to: '/admin/reports', label: '잔업 · 연차', show: isAdmin },
    { key: 'admin-unassigned', to: '/admin/unassigned', label: '미배정 현황', show: isAdmin },
    { key: 'admin-outsource', to: '/admin/outsource', label: '외주 관리', show: isAdmin },
    { key: 'attendance', to: '/attendance', label: '잔업', show: !isAdmin, end: true },
    { key: 'leave', to: '/leave', label: '연차', show: !isAdmin, end: true },
    { key: 'sites', to: '/sites', label: '프로젝트', show: isAdmin || canApproveLeave, end: true },
    { key: 'manage-team-admin', to: '/manage/team', label: '팀구성 관리', show: isAdmin, end: true },
    { key: 'manage-team-employee', to: '/manage/team', label: '우리 팀', show: !isAdmin && !canApproveLeave, end: true },
    { key: 'manage-leave', to: '/manage/leave', label: '우리 팀', show: canApproveLeave && !isAdmin, end: true },
    { key: 'chat', to: '/chat', label: '채팅', show: true, end: true, badgeCount: unreadCount },
    { key: 'admin-events', to: '/admin/events', label: '이벤트 · 공지', show: isAdmin },
  ];
}

export default function Sidebar({ isOpen }) {
  const { isAdmin, canApproveLeave } = useAuth();
  const { unreadCount } = useChat();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return Array.isArray(saved) ? saved : null;
    } catch { return null; }
  });

  const allItems = useMemo(
    () => buildAllItems({ isAdmin, canApproveLeave, unreadCount }),
    [isAdmin, canApproveLeave, unreadCount],
  );

  // 사용자의 저장된 순서대로 정렬, 없으면 기본 순서
  const visibleItems = useMemo(() => {
    const visibles = allItems.filter((it) => it.show);
    if (!order) return visibles;
    const sorted = [];
    for (const key of order) {
      const found = visibles.find((x) => x.key === key);
      if (found) sorted.push(found);
    }
    // 저장된 순서에 없던 새로운 메뉴는 뒤에 추가
    for (const it of visibles) {
      if (!sorted.includes(it)) sorted.push(it);
    }
    return sorted;
  }, [allItems, order]);

  useEffect(() => {
    // 편집 종료 시 localStorage 저장
    if (!editing && order) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(order)); } catch {}
    }
  }, [editing, order]);

  const [draggedKey, setDraggedKey] = useState(null);

  function handleDragStart(e, key) {
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', key); } catch {}
  }

  function handleDragOver(e, overKey) {
    e.preventDefault();
    if (!draggedKey || draggedKey === overKey) return;
    const keys = visibleItems.map((x) => x.key);
    const from = keys.indexOf(draggedKey);
    const to = keys.indexOf(overKey);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...keys];
    next.splice(from, 1);
    next.splice(to, 0, draggedKey);
    setOrder(next);
  }

  function handleDragEnd() {
    setDraggedKey(null);
  }

  function resetOrder() {
    if (!confirm('사이드바 순서를 기본으로 초기화하시겠습니까?')) return;
    localStorage.removeItem(LS_KEY);
    setOrder(null);
  }

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        <div className="sidebar-edit-header">
          <button
            type="button"
            className="sidebar-edit-btn"
            onClick={() => setEditing((e) => !e)}
            title={editing ? '편집 완료' : '순서 수정'}
          >
            {editing ? '완료' : '순서 수정'}
          </button>
          {editing && (
            <button type="button" className="sidebar-edit-btn ghost" onClick={resetOrder} title="기본값 복원">
              초기화
            </button>
          )}
        </div>

        {visibleItems.map((item) => {
          if (editing) {
            return (
              <div
                className={`nav-link nav-edit-row ${draggedKey === item.key ? 'is-dragging' : ''}`}
                key={item.key}
                draggable
                onDragStart={(e) => handleDragStart(e, item.key)}
                onDragOver={(e) => handleDragOver(e, item.key)}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={handleDragEnd}
                title="드래그해서 순서 변경"
              >
                <span className="nav-drag-handle">⋮⋮</span>
                <span className="nav-edit-label">{item.label}</span>
              </div>
            );
          }
          return (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              className={`nav-link ${item.badgeCount > 0 ? 'has-unread' : ''}`}
            >
              {item.label}
              {item.badgeCount > 0 && (
                <span className="nav-badge sidebar-badge">
                  {item.badgeCount > 99 ? '99+' : item.badgeCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
