import { useState, useMemo, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import Modal from './Modal';

const LS_KEY_PREFIX = 'sidebar-order-v1:';
const lsKeyFor = (uid) => (uid ? `${LS_KEY_PREFIX}${uid}` : null);

// 기본 메뉴 정의
function buildAllItems({ isAdmin, canApproveLeave, unreadCount }) {
  return [
    { key: 'home', to: '/dashboard', label: '홈', show: true, end: false },
    { key: 'admin-users', to: '/admin/users', label: '직원 관리', show: isAdmin },
    { key: 'admin-reports', to: '/admin/reports', label: '잔업 · 연차', show: isAdmin },
    { key: 'admin-leaves', to: '/admin/leaves', label: '연차/잔업 신청 목록', show: isAdmin },
    { key: 'admin-unassigned', to: '/admin/unassigned', label: '직원 배치현황', show: isAdmin },
    { key: 'admin-departments', to: '/admin/departments', label: '부서 관리', show: isAdmin },
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
  const { userProfile, isAdmin, canApproveLeave } = useAuth();
  const { unreadCount } = useChat();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(null);
  const [groups, setGroups] = useState([]); // [{ key, label, isGroup: true }]

  // 로그인 계정(uid)이 바뀔 때마다 해당 계정의 순서/대분류 로드
  useEffect(() => {
    const key = lsKeyFor(userProfile?.uid);
    if (!key) { setOrder(null); setGroups([]); return; }
    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      // 구버전 호환: array 형태일 경우 order만
      if (Array.isArray(raw)) {
        setOrder(raw);
        setGroups([]);
      } else if (raw && typeof raw === 'object') {
        setOrder(Array.isArray(raw.order) ? raw.order : null);
        setGroups(Array.isArray(raw.groups) ? raw.groups : []);
      } else {
        setOrder(null);
        setGroups([]);
      }
    } catch { setOrder(null); setGroups([]); }
    setEditing(false);
  }, [userProfile?.uid]);

  const allItems = useMemo(
    () => buildAllItems({ isAdmin, canApproveLeave, unreadCount }),
    [isAdmin, canApproveLeave, unreadCount],
  );

  // 메뉴 + 사용자 추가 대분류 합쳐서 사용자 순서대로 정렬
  const visibleItems = useMemo(() => {
    const visibles = allItems.filter((it) => it.show);
    const groupItems = (groups || []).map((g) => ({ ...g, isGroup: true }));
    const merged = [...visibles, ...groupItems];
    if (!order) return merged;
    const sorted = [];
    for (const k of order) {
      const found = merged.find((x) => x.key === k);
      if (found) sorted.push(found);
    }
    for (const it of merged) {
      if (!sorted.includes(it)) sorted.push(it);
    }
    return sorted;
  }, [allItems, groups, order]);

  // 순서/대분류 변경 시 즉시 저장 — 편집 모드 종료를 기다리지 않음
  // (편집 도중 새로고침해도 데이터 유실 없게)
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (userProfile?.uid) setHydrated(true);
  }, [userProfile?.uid]);
  useEffect(() => {
    const key = lsKeyFor(userProfile?.uid);
    if (!key || !hydrated) return; // 로드 전엔 저장 안 함 (기존 값 덮어쓰기 방지)
    try {
      localStorage.setItem(key, JSON.stringify({ order: order || null, groups }));
    } catch { /* 무시 */ }
  }, [order, groups, userProfile?.uid, hydrated]);

  const [draggedKey, setDraggedKey] = useState(null);
  // 대분류 추가 모달 상태
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');

  function handleDragStart(e, key) {
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', key); } catch { /* 무시 */ }
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
    if (!confirm('사이드바 순서와 추가한 대분류를 모두 기본으로 초기화하시겠습니까?')) return;
    const key = lsKeyFor(userProfile?.uid);
    if (key) localStorage.removeItem(key);
    setOrder(null);
    setGroups([]);
  }

  function openAddGroup() {
    setGroupName('');
    setGroupModalOpen(true);
  }
  function confirmAddGroup() {
    const label = (groupName || '').trim();
    if (!label) return;
    const newGroup = { key: `group-${Date.now()}`, label, isGroup: true };
    setGroups((gs) => [...gs, newGroup]);
    setOrder((o) => {
      const base = o || visibleItems.map((x) => x.key);
      return [...base, newGroup.key];
    });
    setGroupModalOpen(false);
    setGroupName('');
  }

  function deleteGroup(groupKey) {
    if (!confirm('이 대분류를 삭제하시겠습니까?')) return;
    setGroups((gs) => gs.filter((g) => g.key !== groupKey));
    setOrder((o) => (o ? o.filter((k) => k !== groupKey) : o));
  }

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        <div className="sidebar-edit-header">
          {editing && (
            <button
              type="button"
              className="sidebar-edit-icon ghost"
              onClick={resetOrder}
              title="기본값 복원"
              aria-label="기본값 복원"
            >
              ↻
            </button>
          )}
          <button
            type="button"
            className={`sidebar-edit-icon ${editing ? 'is-editing' : ''}`}
            onClick={() => setEditing((e) => !e)}
            title={editing ? '편집 완료' : '순서 수정'}
            aria-label={editing ? '편집 완료' : '순서 수정'}
          >
            {editing ? '✓' : '✎'}
          </button>
        </div>

        {editing && (
          <button type="button" className="sidebar-add-group-btn" onClick={openAddGroup}>
            + 대분류 추가
          </button>
        )}

        {visibleItems.map((item) => {
          if (editing) {
            return (
              <div
                className={`nav-link nav-edit-row ${item.isGroup ? 'is-group' : ''} ${draggedKey === item.key ? 'is-dragging' : ''}`}
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
                {item.isGroup && (
                  <span className="nav-edit-actions">
                    <button
                      type="button"
                      className="nav-edit-del"
                      onClick={(e) => { e.stopPropagation(); deleteGroup(item.key); }}
                      title="대분류 삭제"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            );
          }
          if (item.isGroup) {
            return <div key={item.key} className="nav-group">{item.label}</div>;
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

      <Modal isOpen={groupModalOpen} onClose={() => setGroupModalOpen(false)} title="대분류 추가">
        <div className="form-group">
          <label>대분류 이름</label>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && groupName.trim()) confirmAddGroup(); }}
            placeholder="예: 관리, 일반, 외부"
            autoFocus
            maxLength={20}
          />
          <p className="field-hint" style={{ marginTop: 6 }}>
            메뉴 사이에 들어가는 그룹 헤더입니다. 이후 드래그로 위치를 조정할 수 있어요.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={!groupName.trim()} onClick={confirmAddGroup}>추가</button>
          <button type="button" className="btn btn-outline" onClick={() => setGroupModalOpen(false)}>취소</button>
        </div>
      </Modal>
    </aside>
  );
}
