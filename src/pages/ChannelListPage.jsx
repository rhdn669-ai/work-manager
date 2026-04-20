import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAccessibleChannels, ensureCompanyChannel } from '../services/channelService';
import { subscribeDmRooms, getOrCreateDmRoom } from '../services/chatService';
import { getUsers } from '../services/userService';

export default function ChannelListPage({ onSelectChannel, onSelectDm }) {
  const { userProfile, canApproveAll } = useAuth();
  const [channels, setChannels] = useState([]);
  const [dmRooms, setDmRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [showNewDm, setShowNewDm] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      await ensureCompanyChannel();
      const [list, allUsers] = await Promise.all([
        getAccessibleChannels(userProfile.departmentId, canApproveAll),
        getUsers(),
      ]);
      setChannels(list);
      setUsers(allUsers.filter((u) => u.uid !== userProfile.uid));
      setLoading(false);
    })();
  }, [userProfile?.uid, canApproveAll]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = subscribeDmRooms(userProfile.uid, setDmRooms);
    return () => unsub();
  }, [userProfile?.uid]);

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

  const filteredUsers = users.filter((u) => u.name?.includes(userSearch));

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="channel-list-page">
      <div className="channel-list-header">
        <span className="channel-list-title">채팅</span>
        <button className="channel-new-dm-btn" onClick={() => setShowNewDm(true)} title="새 1:1 대화">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </button>
      </div>

      <div className="channel-list">
        {/* 채널 섹션 */}
        <div className="channel-section-label">채널</div>
        {channels.map((ch) => (
          <button key={ch.id} className="channel-item" onClick={() => onSelectChannel(ch)}>
            <div className={`channel-icon-wrap ${ch.type === 'company' ? 'company' : 'dept'}`}>
              {ch.type === 'company' ? '전사' : '#'}
            </div>
            <div className="channel-info">
              <span className="channel-name">{ch.name}</span>
              <span className="channel-type-label">{ch.type === 'company' ? '전체 공지·대화' : '부서 채팅'}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="channel-arrow">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        ))}

        {/* 1:1 채팅 섹션 */}
        <div className="channel-section-label" style={{ marginTop: 8 }}>1:1 대화</div>
        {dmRooms.length === 0 && (
          <div className="channel-empty-small">아직 대화가 없습니다. 우측 상단 + 버튼으로 시작하세요.</div>
        )}
        {dmRooms.map((room) => {
          const otherUid = room.participants?.find((p) => p !== userProfile.uid);
          const otherName = room.names?.[otherUid] || '알 수 없음';
          const lastMsg = room.lastMessage || '';
          return (
            <button key={room.id} className="channel-item" onClick={() => openExistingDm(room)}>
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
    </div>
  );
}
