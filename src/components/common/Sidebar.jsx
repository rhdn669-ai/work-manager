import { useState, useMemo, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { subscribePreferences, setSidebarPref, clearSidebarPref, setSeededAdminDefaults } from '../../services/userPreferenceService';

// 관리자에게만 1회 자동 추가되는 기본 대분류 (삭제 후 재등장 방지를 위해 didSeedAdminDefaults 플래그로 관리)
const ADMIN_DEFAULT_GROUP_LABELS = ['직원', '외주', '비용'];
import Modal from './Modal';

// 구버전 호환 — 기존 localStorage 값을 1회 Firestore로 마이그레이션 후 삭제
const LS_KEY_PREFIX = 'sidebar-order-v1:';
const lsKeyFor = (uid) => (uid ? `${LS_KEY_PREFIX}${uid}` : null);

// 기본 메뉴 정의
function buildAllItems({ isAdmin, canApproveLeave }) {
  return [
    { key: 'home', to: '/dashboard', label: '홈', show: true, end: false },
    { key: 'admin-users', to: '/admin/users', label: '직원 관리', show: isAdmin },
    { key: 'admin-reports', to: '/admin/reports', label: '잔업 · 연차', show: isAdmin },
    { key: 'admin-leaves', to: '/admin/leaves', label: '연차/잔업 신청 목록', show: isAdmin },
    { key: 'admin-unassigned', to: '/admin/unassigned', label: '직원 배치현황', show: isAdmin },
    { key: 'admin-outsource', to: '/admin/outsource', label: '외주 관리', show: isAdmin },
    { key: 'attendance', to: '/attendance', label: '잔업', show: !isAdmin, end: true },
    { key: 'leave', to: '/leave', label: '연차', show: !isAdmin, end: true },
    { key: 'sites', to: '/sites', label: '프로젝트', show: isAdmin || canApproveLeave, end: true },
    { key: 'admin-total-closing', to: '/admin/total-closing', label: '총 마감', show: isAdmin },
    { key: 'manage-team-admin', to: '/manage/team', label: '팀구성 관리', show: isAdmin, end: true },
    { key: 'manage-team-employee', to: '/manage/team', label: '우리 팀', show: !isAdmin && !canApproveLeave, end: true },
    { key: 'manage-leave', to: '/manage/leave', label: '우리 팀', show: canApproveLeave && !isAdmin, end: true },
    { key: 'admin-events', to: '/admin/events', label: '이벤트 · 공지', show: isAdmin },
    { key: 'admin-vehicle-log', to: '/admin/vehicle-log', label: '운행일지', show: isAdmin },
    { key: 'admin-data-cleanup', to: '/admin/data-cleanup', label: '데이터 정리', show: isAdmin },
  ];
}

export default function Sidebar({ isOpen }) {
  const { userProfile, isAdmin, canApproveLeave } = useAuth();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(null);
  const [groups, setGroups] = useState([]); // [{ key, label, isGroup: true }]

  // 로그인 계정(uid)이 바뀔 때마다 Firestore 구독 + 구버전 LS 마이그레이션 + 관리자 기본 대분류 seed
  // - 처음 동기화될 때 Firestore에 sidebar pref가 없고 LS에 값이 있으면 → 업로드 후 LS 삭제
  // - 관리자(isAdmin=true)이고 didSeedAdminDefaults 플래그가 없으면 → ADMIN_DEFAULT_GROUP_LABELS 1회 추가
  // - 이후 모든 변경은 Firestore가 source of truth (다른 PC/기기 실시간 반영)
  const migratedRef = useRef(false);
  const seedAttemptedRef = useRef(false);
  useEffect(() => {
    const uid = userProfile?.uid;
    setEditing(false);
    migratedRef.current = false;
    seedAttemptedRef.current = false;
    if (!uid) { setOrder(null); setGroups([]); return; }

    const unsub = subscribePreferences(uid, (data) => {
      let nextOrder = null;
      let nextGroups = [];

      const sidebar = data?.sidebar;
      if (sidebar && (Array.isArray(sidebar.order) || Array.isArray(sidebar.groups))) {
        nextOrder = Array.isArray(sidebar.order) ? sidebar.order : null;
        nextGroups = Array.isArray(sidebar.groups) ? sidebar.groups : [];
        setOrder(nextOrder);
        setGroups(nextGroups);
        migratedRef.current = true;
      } else if (!migratedRef.current) {
        // Firestore에 값이 없는 경우 — 구버전 LS 1회 마이그레이션 시도
        migratedRef.current = true;
        const key = lsKeyFor(uid);
        if (key) {
          try {
            const raw = JSON.parse(localStorage.getItem(key) || 'null');
            if (Array.isArray(raw)) {
              nextOrder = raw;
            } else if (raw && typeof raw === 'object') {
              nextOrder = Array.isArray(raw.order) ? raw.order : null;
              nextGroups = Array.isArray(raw.groups) ? raw.groups : [];
            }
          } catch { /* 무시 */ }
        }
        setOrder(nextOrder);
        setGroups(nextGroups);
        if (nextOrder || nextGroups.length > 0) {
          setSidebarPref(uid, { order: nextOrder, groups: nextGroups })
            .then(() => { try { if (key) localStorage.removeItem(key); } catch { /* 무시 */ } })
            .catch(() => { /* 다음 변경 때 재시도됨 */ });
        }
      } else {
        return; // 이미 초기화 완료된 후의 빈 snapshot은 무시
      }

      // 관리자 기본 대분류 1회 seed — 라벨 중복은 건너뛰고 끝에 append
      if (isAdmin && !data?.didSeedAdminDefaults && !seedAttemptedRef.current) {
        seedAttemptedRef.current = true;
        const existing = new Set((nextGroups || []).map((g) => g.label));
        const newOnes = ADMIN_DEFAULT_GROUP_LABELS
          .filter((l) => !existing.has(l))
          .map((l, idx) => ({ key: `group-default-${Date.now()}-${idx}`, label: l, isGroup: true }));
        if (newOnes.length > 0) {
          setGroups([...(nextGroups || []), ...newOnes]);
          // saveTimer 효과(300ms 디바운스)가 자동으로 Firestore에 반영
        }
        // 추가 여부와 무관하게 플래그 마킹 — 사용자가 삭제해도 재등장하지 않도록
        setSeededAdminDefaults(uid).catch(() => { /* 무시 */ });
      }
    });
    return () => unsub();
  }, [userProfile?.uid, isAdmin]);

  const allItems = useMemo(
    () => buildAllItems({ isAdmin, canApproveLeave }),
    [isAdmin, canApproveLeave],
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

  // 순서/대분류 변경 시 Firestore에 디바운스 저장 (300ms) — 다른 기기에 실시간 전파
  const saveTimerRef = useRef(null);
  useEffect(() => {
    const uid = userProfile?.uid;
    if (!uid || !migratedRef.current) return; // 최초 로드 전에는 저장 안 함 (덮어쓰기 방지)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSidebarPref(uid, { order: order || null, groups }).catch(() => { /* 무시 */ });
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [order, groups, userProfile?.uid]);

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
    const uid = userProfile?.uid;
    const key = lsKeyFor(uid);
    if (key) { try { localStorage.removeItem(key); } catch { /* 무시 */ } }
    setOrder(null);
    setGroups([]);
    if (uid) clearSidebarPref(uid).catch(() => { /* 무시 */ });
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
            {editing ? (
              '✓'
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            )}
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
            return (
              <div key={item.key} className="nav-group">
                <span className="nav-group-label">{item.label}</span>
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
