import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';

const ChatContext = createContext({ unreadCount: 0, markAsRead: () => {} });

// 채널/DM 단위로 마지막 읽은 시각을 localStorage에 기록
// key 예: chatRead_<uid>_channel_<channelId>, chatRead_<uid>_dm_<roomId>
const readKey = (uid, kind, id) => `chatRead_${uid}_${kind}_${id}`;

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

export function ChatProvider({ children }) {
  const { userProfile, canApproveAll } = useAuth();
  const [channelMetas, setChannelMetas] = useState([]); // [{id, type, departmentId, memberIds, lastMessageAt, lastSenderId}]
  const [dmRooms, setDmRooms] = useState([]); // [{id, lastMessageAt, lastSenderId, ...}]
  // "읽은 시각 틱" — markAsRead가 불릴 때 증가시켜 재계산 유발
  const [readTick, setReadTick] = useState(0);

  // 전체 채널 메타데이터 구독 (메시지 서브컬렉션이 아니라 채널 doc만)
  useEffect(() => {
    if (!userProfile?.uid) { setChannelMetas([]); return; }
    const unsub = onSnapshot(collection(db, 'channels'), (snap) => {
      setChannelMetas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setChannelMetas([]));
    return () => unsub();
  }, [userProfile?.uid]);

  // 내가 참여한 DM 방 구독
  useEffect(() => {
    if (!userProfile?.uid) { setDmRooms([]); return; }
    const q = query(collection(db, 'dmRooms'), where('participants', 'array-contains', userProfile.uid));
    const unsub = onSnapshot(q, (snap) => {
      setDmRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setDmRooms([]));
    return () => unsub();
  }, [userProfile?.uid]);

  // 접근 가능한 채널만 필터링
  const accessibleChannels = useMemo(() => {
    if (!userProfile?.uid) return [];
    if (canApproveAll) return channelMetas;
    return channelMetas.filter((c) => {
      if (c.type === 'company') return true;
      if (c.type === 'department') return c.departmentId === userProfile.departmentId;
      if (c.type === 'custom') return (c.memberIds || []).includes(userProfile.uid);
      return false;
    });
  }, [channelMetas, userProfile?.uid, userProfile?.departmentId, canApproveAll]);

  // unread = (내가 안 보낸) 마지막 메시지의 시각이 localStorage의 lastRead 이후인 방의 개수
  // (정확한 메시지 수가 아니라 "읽지 않은 방 개수" — 다수 리스너 회피)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unreadCount = useMemo(() => {
    if (!userProfile?.uid) return 0;
    let n = 0;
    const uid = userProfile.uid;
    accessibleChannels.forEach((c) => {
      const lastMs = tsToMs(c.lastMessageAt);
      if (!lastMs) return;
      if (c.lastSenderId === uid) return;
      const read = parseInt(localStorage.getItem(readKey(uid, 'channel', c.id)) || '0', 10);
      if (lastMs > read) n += 1;
    });
    dmRooms.forEach((r) => {
      const lastMs = tsToMs(r.lastMessageAt);
      if (!lastMs) return;
      if (r.lastSenderId === uid) return;
      const read = parseInt(localStorage.getItem(readKey(uid, 'dm', r.id)) || '0', 10);
      if (lastMs > read) n += 1;
    });
    return n;
  }, [accessibleChannels, dmRooms, userProfile?.uid, readTick]);

  // 단일 방 읽음 처리 — 그 방의 lastMessageAt 현재 시각으로 기록
  const markAsRead = useCallback((kind, id) => {
    if (!userProfile?.uid) return;
    if (!kind || !id) {
      // 인자 없이 호출 시 모든 방을 현재 시각으로 읽음 처리 (호환용)
      const now = Date.now().toString();
      accessibleChannels.forEach((c) => localStorage.setItem(readKey(userProfile.uid, 'channel', c.id), now));
      dmRooms.forEach((r) => localStorage.setItem(readKey(userProfile.uid, 'dm', r.id), now));
      setReadTick((t) => t + 1);
      return;
    }
    localStorage.setItem(readKey(userProfile.uid, kind, id), Date.now().toString());
    setReadTick((t) => t + 1);
  }, [userProfile?.uid, accessibleChannels, dmRooms]);

  return (
    <ChatContext.Provider value={{ unreadCount, markAsRead }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
