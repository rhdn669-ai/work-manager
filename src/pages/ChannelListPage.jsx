import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getAccessibleChannels, ensureCompanyChannel,
  createCustomChannel, updateCustomChannel, deleteCustomChannel,
} from '../services/channelService';
import { subscribeDmRooms, getOrCreateDmRoom, hideDmRoomForUser } from '../services/chatService';
import { getUsers } from '../services/userService';

export default function ChannelListPage({ onSelectChannel, onSelectDm }) {
  const { userProfile, canApproveAll, isAdmin } = useAuth();
  const [channels, setChannels] = useState([]);
  const [dmRooms, setDmRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [showNewDm, setShowNewDm] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // 채널 생성/수정 모달
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState(null);
  const [form, setForm] = useState({ name: '', memberIds: [] });
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    if (!userProfile) return;
    refreshChannels();
  }, [userProfile?.uid, canApproveAll]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = subscribeDmRooms(userProfile.uid, setDmRooms);
    return () => unsub();
  }, [userProfile?.uid]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = (e) => {
      if (!e.target.closest('.channel-menu-wrap')) setOpenMenuId(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  async function refreshChannels() {
    await ensureCompanyChannel();
    const [list, allUsers] = await Promise.all([
      getAccessibleChannels(userProfile.uid, userProfile.departmentId, canApproveAll),
      getUsers(),
    ]);
    setChannels(list);
    setUsers(allUsers.filter((u) => u.uid !== userProfile.uid));
    setLoading(false);
  }

  async function startDm(user) {
    const roomId = await getOrCreateDmRoom(userProfile.uid, user.uid, userProfile.name, user.name);
    setShowNewDm(false);
    setUserSearch('');
    onSelectDm({ roomId, otherName: user.name, otherUid: user.uid });
  }

  function openExistingDm(room) {
    const otherUid = room.participants?.find((p) => p !== userProfile.uid);
    const otherName = room.names?.[otherUid] || '알 수 없음';
    onSelectDm({ roomId: room.id, otherName, otherUid });
  }

  function openCreateChannel() {
    setEditingChannel(null);
    setForm({ name: '', memberIds: [] });
    setShowChannelModal(true);
  }

  function openEditChannel(ch) {
    setEditingChannel(ch);
    setForm({ name: ch.name || '', memberIds: [...(ch.memberIds || [])] });
    setShowChannelModal(true);
    setOpenMenuId(null);
  }

  async function handleSaveChannel(e) {
    e.preventDefault();
    if (!form.name.trim()) { alert('채널 이름을 입력해주세요.'); return; }
    if (form.memberIds.length === 0) { alert('참여할 멤버를 1명 이상 선택해주세요.'); return; }
    setSaving(true);
    try {
      if (editingChannel) {
        await updateCustomChannel(editingChannel.id, { name: form.name.trim(), memberIds: form.memberIds });
      } else {
        const ids = [...new Set([...form.memberIds, userProfile.uid])];
        await createCustomChannel({ name: form.name.trim(), memberIds: ids, creatorId: userProfile.uid });
      }
      setShowChannelModal(false);
      await refreshChannels();
    } catch (err) {
      alert('저장 실패: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteChannel(ch) {
    if (!confirm(`"${ch.name}" 채팅방을 삭제하시겠습니까?\n대화 내역도 모두 삭제됩니다.`)) return;
    try {
      await deleteCustomChannel(ch.id);
      setOpenMenuId(null);
      await refreshChannels();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

  function toggleMember(uid) {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(uid)
        ? f.memberIds.filter((x) => x !== uid)
        : [...f.memberIds, uid],
    }));
  }

  const filteredUsers = users.filter((u) => u.name?.includes(userSearch));

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="channel-list-page">
      <div className="channel-list-header">
        <span className="channel-list-title">채팅</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {isAdmin && (
            <button className="channel-new-dm-btn" onClick={openCreateChannel} title="새 채팅방">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <circle cx="9" cy="7" r="4"/>
                <path d="M17 11v6"/><path d="M14 14h6"/>
                <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
              </svg>
            </button>
          )}
          <button className="channel-new-dm-btn" onClick={() => setShowNewDm(true)} title="새 1:1 대화">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="channel-list">
        <div className="channel-section-label">채널</div>
        {channels.map((ch) => {
          const isCustom = ch.type === 'custom';
          return (
            <div key={ch.id} className="channel-row channel-menu-wrap">
              <button className="channel-item" onClick={() => onSelectChannel(ch)}>
                <div className={`channel-icon-wrap ${ch.type === 'company' ? 'company' : isCustom ? 'custom' : 'dept'}`}>
                  {ch.type === 'company' ? '전체' : isCustom ? '★' : '#'}
                </div>
                <div className="channel-info">
                  <span className="channel-name">{ch.name}</span>
                  <span className="channel-type-label">
                    {ch.type === 'company' ? '전체 공지 · 대화' :
                     isCustom ? `멤버 ${(ch.memberIds || []).length}명` : '부서 채팅'}
                  </span>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="channel-arrow">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
              {isAdmin && isCustom && (
                <>
                  <button
                    type="button"
                    className="channel-menu-btn"
                    aria-label="관리"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === ch.id ? null : ch.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                      <circle cx="12" cy="5" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="12" cy="19" r="1.8" />
                    </svg>
                  </button>
                  {openMenuId === ch.id && (
                    <div className="channel-menu" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openEditChannel(ch)}>수정</button>
                      <button type="button" className="channel-menu-danger" onClick={() => handleDeleteChannel(ch)}>삭제</button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        <div className="channel-section-label" style={{ marginTop: 8 }}>1:1 대화</div>
        {dmRooms.length === 0 && (
          <div className="channel-empty-small">아직 대화가 없습니다. 우측 상단 + 버튼으로 시작하세요.</div>
        )}
        {dmRooms.map((room) => {
          const otherUid = room.participants?.find((p) => p !== userProfile.uid);
          const otherName = room.names?.[otherUid] || '알 수 없음';
          const lastMsg = room.lastMessage || '';
          const menuOpen = openMenuId === `dm_${room.id}`;
          return (
            <div key={room.id} className="channel-row channel-menu-wrap">
              <button className="channel-item" onClick={() => openExistingDm(room)}>
                <div className="channel-icon-wrap dm-avatar">
                  {otherName?.[0] || '?'}
                </div>
                <div className="channel-info">
                  <span className="channel-name">{otherName}</span>
                  <span className="channel-type-label">{lastMsg || '대화를 시작해보세요'}</span>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="channel-arrow">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
              <button
                type="button"
                className="channel-menu-btn"
                aria-label="관리"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpenMenuId(menuOpen ? null : `dm_${room.id}`);
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <circle cx="12" cy="5" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="12" cy="19" r="1.8" />
                </svg>
              </button>
              {menuOpen && (
                <div className="channel-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="channel-menu-danger"
                    onClick={async () => {
                      if (!confirm(`${otherName}님과의 대화를 내 목록에서 숨기시겠습니까?\n(상대방 쪽에는 그대로 남아 있고, 상대가 다시 메시지를 보내면 다시 나타납니다)`)) return;
                      try {
                        await hideDmRoomForUser(room.id, userProfile.uid);
                        setOpenMenuId(null);
                      } catch (err) {
                        alert('삭제 실패: ' + err.message);
                      }
                    }}
                  >
                    내 목록에서 삭제
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 새 1:1 대화 모달 */}
      {showNewDm && (
        <div className="channel-modal-overlay" onClick={() => { setShowNewDm(false); setUserSearch(''); }}>
          <div className="channel-modal" onClick={(e) => e.stopPropagation()}>
            <div className="channel-modal-header">
              <span>대화 상대 선택</span>
              <button className="channel-modal-close" onClick={() => { setShowNewDm(false); setUserSearch(''); }}>✕</button>
            </div>
            <input
              className="channel-modal-search"
              placeholder="이름 검색..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              autoFocus
            />
            <div className="channel-modal-list">
              {filteredUsers.map((u) => (
                <button key={u.uid} className="channel-modal-user" onClick={() => startDm(u)}>
                  <div className="channel-icon-wrap dm-avatar">{u.name?.[0] || '?'}</div>
                  <div className="channel-info">
                    <span className="channel-name">{u.name}</span>
                    <span className="channel-type-label">{u.position || u.department || ''}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 채널 생성/수정 모달 (관리자) */}
      {showChannelModal && (
        <div className="channel-modal-overlay" onClick={() => setShowChannelModal(false)}>
          <div className="channel-modal" onClick={(e) => e.stopPropagation()}>
            <div className="channel-modal-header">
              <span>{editingChannel ? '채팅방 수정' : '새 채팅방'}</span>
              <button className="channel-modal-close" onClick={() => setShowChannelModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveChannel} style={{ padding: 12 }}>
              <div className="form-group">
                <label>채팅방 이름 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="예: 프로젝트 A 협업방"
                  required
                />
              </div>
              <div className="form-group">
                <label>참여 멤버 * ({form.memberIds.length}명 선택됨)</label>
                <div className="select-dropdown-list" style={{ maxHeight: 240 }}>
                  {users.map((u) => {
                    const checked = form.memberIds.includes(u.uid);
                    return (
                      <label key={u.uid} className={`select-list-item ${checked ? 'is-checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(u.uid)} />
                        <span className="select-list-name">{u.name}</span>
                        <span className="select-list-sub">{u.position || u.department || ''}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '저장 중...' : (editingChannel ? '수정' : '생성')}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setShowChannelModal(false)}>취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
