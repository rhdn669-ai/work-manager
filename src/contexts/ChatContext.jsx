import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import { subscribePreferences, setChatRead, setChatReadBulk } from '../services/userPreferenceService';

const ChatContext = createContext({ unreadCount: 0, markAsRead: () => {} });

// 구버전 호환 — localStorage에 남아있는 읽음 데이터를 1회 Firestore로 마이그레이션 후 삭제
const lsReadKey = (uid, kind, id) => `chatRead_${uid}_${kind}_${id}`;
const lsReadCountKey = (uid, kind, id) => `chatReadCount_${uid}_${kind}_${id}`;

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
  // 채팅 읽음 상태 (Firestore userPreferences/{uid}.chatReads) — 다른 기기와 실시간 동기화
  // 형태: { 'channel_xxx': { count, ts }, 'dm_yyy': { count, ts } }
  const [chatReads, setChatReads] = useState({});
  const chatReadsRef = useRef({});
  chatReadsRef.current = chatReads;

  // 전체 채널 메타데이터 구독 (메시지 서브컬렉션이 아니라 채널 doc만)
  useEffect(() => {
    if (!userProfile?.uid) { setChannelMetas([]); return; }
    const unsub = onSnapshot(collection(db, 'channels'), (snap) => {
      setChannelMetas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setChannelMetas([]));
    return () => unsub();
  }, [userProfile?.uid]);

  // 내가 참여한 DM 방 구독 — 내가 hiddenBy에 들어가있는 방은 알림 집계에서 제외
  // (목록에선 안 보이는데 배지만 떠있는 유령 알림 방지)
  useEffect(() => {
    if (!userProfile?.uid) { setDmRooms([]); return; }
    const uid = userProfile.uid;
    const q = query(collection(db, 'dmRooms'), where('participants', 'array-contains', uid));
    const unsub = onSnapshot(q, (snap) => {
      const rooms = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => !(Array.isArray(r.hiddenBy) && r.hiddenBy.includes(uid)));
      setDmRooms(rooms);
    }, () => setDmRooms([]));
    return () => unsub();
  }, [userProfile?.uid]);

  // 채팅 읽음 상태 Firestore 구독 — 다른 기기와 실시간 동기화
  // 최초 동기화 시 Firestore에 값이 없고 localStorage에 구버전 값이 있으면 1회 업로드 후 LS 삭제
  const chatReadMigratedRef = useRef(false);
  useEffect(() => {
    const uid = userProfile?.uid;
    chatReadMigratedRef.current = false;
    if (!uid) { setChatReads({}); return; }

    const unsub = subscribePreferences(uid, (data) => {
      const incoming = data?.chatReads;
      if (incoming && typeof incoming === 'object' && Object.keys(incoming).length > 0) {
        setChatReads(incoming);
        chatReadMigratedRef.current = true;
        return;
      }
      // Firestore에 chatReads가 없으면 localStorage 마이그레이션 시도 (1회만)
      if (chatReadMigratedRef.current) return;
      chatReadMigratedRef.current = true;
      try {
        const migrated = {};
        const entries = [];
        // localStorage 전체 키 스캔 — `chatReadCount_{uid}_{kind}_{id}` 패턴
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          const prefix = `chatReadCount_${uid}_`;
          if (!k.startsWith(prefix)) continue;
          const rest = k.slice(prefix.length); // `{kind}_{id}` 형태
          const sep = rest.indexOf('_');
          if (sep <= 0) continue;
          const kind = rest.slice(0, sep);
          const id = rest.slice(sep + 1);
          const count = parseInt(localStorage.getItem(k) || '0', 10);
          const ts = parseInt(localStorage.getItem(lsReadKey(uid, kind, id)) || '0', 10);
          if (!kind || !id) continue;
          migrated[`${kind}_${id}`] = { count: count || 0, ts: ts || Date.now() };
          entries.push({ kind, roomId: id, count: count || 0, ts: ts || Date.now() });
        }
        if (entries.length > 0) {
          setChatReads(migrated);
          setChatReadBulk(uid, entries)
            .then(() => {
              // 업로드 성공 → LS에서 해당 키 정리
              for (const { kind, roomId } of entries) {
                try { localStorage.removeItem(lsReadKey(uid, kind, roomId)); } catch { /* 무시 */ }
                try { localStorage.removeItem(lsReadCountKey(uid, kind, roomId)); } catch { /* 무시 */ }
              }
            })
            .catch(() => { /* 다음 markAsRead 때 재시도됨 */ });
        } else {
          setChatReads({});
        }
      } catch {
        setChatReads({});
      }
    });
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

  // unreadCounts: 방별 정확한 읽지 않음 수 (messageCount - chatReads[key].count)
  // - 카운터 필드(messageCount)가 없는 기존 방은 0으로 처리 (메시지 없음)
  // - 내가 마지막으로 보낸 메시지면 0 (읽음 간주)
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
      const total = Number(room.messageCount || 0);
      if (total <= 0) return 0;
      if (room.lastSenderId === uid) return 0;
      const entry = chatReads[`${kind}_${room.id}`];
      const readCount = Number(entry?.count || 0);
      return Math.max(0, total - readCount);
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
  }, [accessibleChannels, dmRooms, userProfile?.uid, chatReads]);

  // 단일 방 읽음 처리 — Firestore에 저장 (다른 기기와 실시간 동기화)
  // 로컬 state는 즉시 갱신해 UI 반응성 확보, Firestore 저장은 백그라운드
  const markAsRead = useCallback((kind, id) => {
    if (!userProfile?.uid) return;
    const uid = userProfile.uid;
    const now = Date.now();
    if (!kind || !id) {
      // 인자 없이 호출 시 모든 방을 읽음 처리
      const entries = [];
      const nextLocal = { ...chatReadsRef.current };
      accessibleChannels.forEach((c) => {
        const cnt = Number(c.messageCount || 0);
        nextLocal[`channel_${c.id}`] = { count: cnt, ts: now };
        entries.push({ kind: 'channel', roomId: c.id, count: cnt, ts: now });
      });
      dmRooms.forEach((r) => {
        const cnt = Number(r.messageCount || 0);
        nextLocal[`dm_${r.id}`] = { count: cnt, ts: now };
        entries.push({ kind: 'dm', roomId: r.id, count: cnt, ts: now });
      });
      setChatReads(nextLocal);
      setChatReadBulk(uid, entries).catch(() => { /* 무시 */ });
      return;
    }
    const room = kind === 'channel'
      ? accessibleChannels.find((c) => c.id === id)
      : dmRooms.find((r) => r.id === id);
    // race condition 방지 — 방 데이터가 아직 로드되지 않았으면 readCount 갱신 보류
    if (!room) return;
    const cnt = Number(room.messageCount || 0);
    setChatReads((prev) => ({ ...prev, [`${kind}_${id}`]: { count: cnt, ts: now } }));
    setChatRead(uid, kind, id, { count: cnt, ts: now }).catch(() => { /* 무시 */ });
  }, [userProfile?.uid, accessibleChannels, dmRooms]);

  // 알림 소리/브라우저 Notification — unreadCount 증가 시 1회 발화
  const prevUnreadRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  useEffect(() => {
    // 마운트 후 5초 동안은 알림 skip — 초기 데이터 로딩으로 튀는 값에 beep 방지
    if (Date.now() - mountTimeRef.current < 5000) {
      prevUnreadRef.current = unreadCount;
      return;
    }
    if (unreadCount > prevUnreadRef.current) {
      // 탭이 보이는 상태(채팅방 열려있는 상태 포함)에서는 beep 안 함 — 시끄러움 방지
      const tabHidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';
      if (tabHidden) {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) {
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); osc.stop(ctx.currentTime + 0.3);
            setTimeout(() => ctx.close(), 400);
          }
        } catch { /* 무시 */ }
      }
      // 2) 브라우저 알림 (권한 허용된 경우에만, 탭이 백그라운드일 때)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { new Notification('새 메시지', { body: `읽지 않은 메시지 ${unreadCount}건`, tag: 'wm-chat-unread' }); } catch { /* 무시 */ }
      }
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // Notification 권한 요청 (아직 결정 안 된 경우에만 한 번)
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}); } catch { /* 무시 */ }
    }
  }, []);

  return (
    <ChatContext.Provider value={{ unreadCount, unreadRoomIds, unreadCounts, markAsRead }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
