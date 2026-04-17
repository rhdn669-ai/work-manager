import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUsers } from '../services/userService';
import { subscribeDmRooms, getOrCreateDmRoom } from '../services/chatService';
import DmChatPage from './DmChatPage';

export default function DmListPage() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null); // { roomId, otherName }
  const [searchUser, setSearchUser] = useState('');

  useEffect(() => {
    getUsers().then((all) => setUsers(all.filter((u) => u.uid !== userProfile?.uid)));
  }, [userProfile?.uid]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = subscribeDmRooms(userProfile.uid, setRooms);
    return () => unsub();
  }, [userProfile?.uid]);

  async function openDm(user) {
    const roomId = await getOrCreateDmRoom(userProfile.uid, user.uid, userProfile.name, user.name);
    setActiveRoom({ roomId, otherName: user.name, otherUid: user.uid });
  }

  if (activeRoom) {
    return <DmChatPage room={activeRoom} onBack={() => setActiveRoom(null)} />;
  }

  const filteredUsers = users.filter((u) => u.name?.includes(searchUser));

  return (
    <div className="dm-list-page">
      <div className="dm-section-title">대화 상대 선택</div>
      <input
        className="dm-search-input"
        placeholder="직원 검색..."
        value={searchUser}
        onChange={(e) => setSearchUser(e.target.value)}
      />
      <div className="dm-user-list">
        {filteredUsers.map((u) => {
          const room = rooms.find((r) => r.participants?.includes(u.uid));
          return (
            <button key={u.uid} className="dm-user-item" onClick={() => openDm(u)}>
              <div className="dm-user-avatar">{u.name?.[0] || '?'}</div>
              <div className="dm-user-info">
                <span className="dm-user-name">{u.name}</span>
                <span className="dm-user-pos">{u.position || u.department || ''}</span>
              </div>
              {room?.lastMessage && <span className="dm-last-msg">{room.lastMessage}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
