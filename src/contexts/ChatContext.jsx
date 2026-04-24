import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';

const ChatContext = createContext({ unreadCount: 0, markAsRead: () => {} });

// 채널/DM 단위로 마지막 읽은 시각을 localStorage에 기록 (하위 호환용)
const readKey = (uid, kind, id) => `chatRead_${uid}_${kind}_${id}`;
// 채널/DM 단위로 마지막 읽은 messageCount를 저장 (정확한 읽지 않음 수 계산용)
const readCountKey = (uid, kind, id) => `chatReadCount_${uid}_${kind}_${id}`;

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

  // unreadCounts: 방별 정확한 읽지 않음 수 (messageCount - lastReadCount)
  // - 카운터 필드(messageCount)가 없는 기존 방은 timestamp 기반 fallback (1 또는 0)
  // - 내가 마지막으로 보낸 메시지면 0 (읽음 간주)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { unreadCount, unreadRoomIds, unreadCounts } = useMemo(() => {
    const empty = {
      unreadCount: 0,
      unreadRoomIds: { channel: new Set(), dm: new Set() },
      unreadCounts: { channel: {}, dm: {} },
    };
    if (!userProfile?.uid) return empty;
    const uid = userProfile.uid;
    const channelSet = new Set();
    const dmSet = new Set();
    const channelCount = {};
    const dmCount = {};

    function countFor(kind, room) {
      const lastMs = tsToMs(room.lastMessageAt);
      if (!lastMs) return 0;
      if (room.lastSenderId === uid) return 0;
      // messageCount 기반
      const total = Number(room.messageCount || 0);
      if (total > 0) {
        const readCount = parseInt(localStorage.getItem(readCountKey(uid, kind, room.id)) || '0', 10);
        return Math.max(0, total - readCount);
      }
      // fallback: timestamp 비교 — 미읽음이면 1
      const read = parseInt(localStorage.getItem(readKey(uid, kind, room.id)) || '0', 10);
      return lastMs > read ? 1 : 0;
    }

    accessibleChannels.forEach((c) => {
      const n = countFor('channel', c);
      if (n > 0) { channelSet.add(c.id); channelCount[c.id] = n; }
    });
    dmRooms.forEach((r) => {
      const n = countFor('dm', r);
      if (n > 0) { dmSet.add(r.id); dmCount[r.id] = n; }
    });
    const total = [...Object.values(channelCount), ...Object.values(dmCount)].reduce((s, n) => s + n, 0);
    return {
      unreadCount: total,
      unreadRoomIds: { channel: channelSet, dm: dmSet },
      unreadCounts: { channel: channelCount, dm: dmCount },
    };
  }, [accessibleChannels, dmRooms, userProfile?.uid, readTick]);

  // 단일 방 읽음 처리 — messageCount와 timestamp를 현재 값으로 기록
  const markAsRead = useCallback((kind, id) => {
    if (!userProfile?.uid) return;
    const uid = userProfile.uid;
    const now = Date.now().toString();
    if (!kind || !id) {
      // 인자 없이 호출 시 모든 방을 읽음 처리 (호환용)
      accessibleChannels.forEach((c) => {
        localStorage.setItem(readKey(uid, 'channel', c.id), now);
        localStorage.setItem(readCountKey(uid, 'channel', c.id), String(Number(c.messageCount || 0)));
      });
      dmRooms.forEach((r) => {
        localStorage.setItem(readKey(uid, 'dm', r.id), now);
        localStorage.setItem(readCountKey(uid, 'dm', r.id), String(Number(r.messageCount || 0)));
      });
      setReadTick((t) => t + 1);
      return;
    }
    const room = kind === 'channel'
      ? accessibleChannels.find((c) => c.id === id)
      : dmRooms.find((r) => r.id === id);
    localStorage.setItem(readKey(uid, kind, id), now);
    localStorage.setItem(readCountKey(uid, kind, id), String(Number(room?.messageCount || 0)));
    setReadTick((t) => t + 1);
  }, [userProfile?.uid, accessibleChannels, dmRooms]);

  return (
    <ChatContext.Provider value={{ unreadCount, unreadRoomIds, unreadCounts, markAsRead }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
