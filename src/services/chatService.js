import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
  query, orderBy, limit, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, ensureAnonymousAuth } from '../config/firebase';

const MSG = collection(db, 'chatMessages');
const TYPING = collection(db, 'typingStatus');
const DM_ROOMS = collection(db, 'dmRooms');

// ── 전체 채팅 ──────────────────────────────────────────
export function subscribeMessages(callback) {
  const q = query(MSG, orderBy('createdAt', 'asc'), limit(300));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function sendMessage({ userId, userName, position, text, replyTo = null }) {
  return addDoc(MSG, {
    userId, userName, position,
    text, type: 'text',
    replyTo,
    reactions: {},
    readBy: { [userId]: Date.now() },
    isPinned: false,
    deletedAt: null,
    createdAt: serverTimestamp(),
  });
}

export async function sendImage({ userId, userName, position, file, replyTo = null }) {
  await ensureAnonymousAuth();
  const storageRef = ref(storage, `chat/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const imageUrl = await getDownloadURL(storageRef);
  return addDoc(MSG, {
    userId, userName, position,
    text: '', type: 'image', imageUrl,
    replyTo,
    reactions: {},
    readBy: { [userId]: Date.now() },
    isPinned: false,
    deletedAt: null,
    createdAt: serverTimestamp(),
  });
}

export async function sendFile({ userId, userName, position, file, replyTo = null }) {
  await ensureAnonymousAuth();
  const storageRef = ref(storage, `chat/files/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);
  return addDoc(MSG, {
    userId, userName, position,
    text: '', type: 'file', fileUrl, fileName: file.name, fileSize: file.size,
    replyTo,
    reactions: {},
    readBy: { [userId]: Date.now() },
    isPinned: false,
    deletedAt: null,
    createdAt: serverTimestamp(),
  });
}

export async function deleteMessage(msgId) {
  await updateDoc(doc(MSG, msgId), { deletedAt: serverTimestamp(), text: '삭제된 메시지입니다.', imageUrl: null, fileUrl: null, fileName: null });
}

export async function deleteAllMessages() {
  const snap = await getDocs(MSG);
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(MSG, d.id))));
}

export async function editMessage(msgId, newText) {
  await updateDoc(doc(MSG, msgId), { text: newText, editedAt: serverTimestamp() });
}

export async function editDmMessage(roomId, msgId, newText) {
  await updateDoc(doc(db, 'dmRooms', roomId, 'messages', msgId), { text: newText, editedAt: serverTimestamp() });
}

export async function toggleReaction(msgId, emoji, userId) {
  const msgRef = doc(MSG, msgId);
  const snap = await getDoc(msgRef);
  const reactions = snap.data()?.reactions || {};
  const users = reactions[emoji] || [];
  const next = users.includes(userId)
    ? users.filter((u) => u !== userId)
    : [...users, userId];
  await updateDoc(msgRef, { [`reactions.${emoji}`]: next });
}

export async function pinMessage(msgId, pin) {
  await updateDoc(doc(MSG, msgId), { isPinned: pin, pinnedAt: pin ? serverTimestamp() : null });
}

export async function getPinnedMessage() {
  const q = query(MSG, where('isPinned', '==', true), orderBy('pinnedAt', 'desc'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function markRead(msgId, userId) {
  await updateDoc(doc(MSG, msgId), { [`readBy.${userId}`]: Date.now() });
}

// ── 입력 중 상태 ───────────────────────────────────────
export async function setTyping(userId, userName, isTyping) {
  const { setDoc } = await import('firebase/firestore');
  await setDoc(doc(TYPING, userId), { isTyping, userName, updatedAt: Date.now() }, { merge: true });
}

export function subscribeTyping(myUserId, callback) {
  return onSnapshot(TYPING, (snap) => {
    const now = Date.now();
    const typing = snap.docs
      .filter((d) => d.id !== myUserId && d.data().isTyping && now - d.data().updatedAt < 5000)
      .map((d) => d.data().userName);
    callback(typing);
  });
}

// ── 1:1 채팅 ───────────────────────────────────────────
export function getDmRoomId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

export async function getOrCreateDmRoom(uid1, uid2, name1, name2) {
  const roomId = getDmRoomId(uid1, uid2);
  const roomRef = doc(DM_ROOMS, roomId);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) {
    await setDoc(roomRef, {
      participants: [uid1, uid2],
      names: { [uid1]: name1, [uid2]: name2 },
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      hiddenBy: [],
      messageCount: 0,
      createdAt: serverTimestamp(),
    });
  }
  return roomId;
}

export async function setDmTyping(roomId, userId, userName, isTyping) {
  const ref = doc(db, 'dmRooms', roomId, 'typing', userId);
  await setDoc(ref, { isTyping, userName, updatedAt: Date.now() }, { merge: true });
}

export function subscribeDmTyping(roomId, myUserId, callback) {
  const typingCol = collection(db, 'dmRooms', roomId, 'typing');
  return onSnapshot(typingCol, (snap) => {
    const now = Date.now();
    const typing = snap.docs
      .filter((d) => d.id !== myUserId && d.data().isTyping && now - d.data().updatedAt < 5000)
      .map((d) => d.data().userName);
    callback(typing);
  });
}

export function subscribeDmMessages(roomId, callback) {
  const msgRef = collection(db, 'dmRooms', roomId, 'messages');
  const q = query(msgRef, orderBy('createdAt', 'asc'), limit(300));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function sendDmMessage({ roomId, userId, userName, position, text, replyTo = null }) {
  const msgRef = collection(db, 'dmRooms', roomId, 'messages');
  await addDoc(msgRef, {
    userId, userName, position,
    text, type: 'text',
    replyTo,
    reactions: {},
    readBy: { [userId]: Date.now() },
    deletedAt: null,
    createdAt: serverTimestamp(),
  });
  // 메시지 송신 → hiddenBy 전체 초기화 (숨겨놨던 사람한테도 다시 나타나도록)
  await updateDoc(doc(DM_ROOMS, roomId), { lastMessage: text, lastMessageAt: serverTimestamp(), lastSenderId: userId, hiddenBy: [], messageCount: increment(1) });
}

export async function sendDmImage({ roomId, userId, userName, position, file, replyTo = null }) {
  await ensureAnonymousAuth();
  const storageRef = ref(storage, `dm/${roomId}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const imageUrl = await getDownloadURL(storageRef);
  const msgRef = collection(db, 'dmRooms', roomId, 'messages');
  await addDoc(msgRef, {
    userId, userName, position,
    text: '', type: 'image', imageUrl,
    replyTo,
    reactions: {},
    readBy: { [userId]: Date.now() },
    deletedAt: null,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(DM_ROOMS, roomId), { lastMessage: '📷 사진', lastMessageAt: serverTimestamp(), lastSenderId: userId, hiddenBy: [], messageCount: increment(1) });
}

export async function sendDmFile({ roomId, userId, userName, position, file, replyTo = null }) {
  await ensureAnonymousAuth();
  const storageRef = ref(storage, `dm/${roomId}/files/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);
  const msgRef = collection(db, 'dmRooms', roomId, 'messages');
  await addDoc(msgRef, {
    userId, userName, position,
    text: '', type: 'file', fileUrl, fileName: file.name, fileSize: file.size,
    replyTo,
    reactions: {},
    readBy: { [userId]: Date.now() },
    deletedAt: null,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(DM_ROOMS, roomId), { lastMessage: `📎 ${file.name}`, lastMessageAt: serverTimestamp(), lastSenderId: userId, hiddenBy: [], messageCount: increment(1) });
}

export async function deleteDmMessage(roomId, msgId) {
  const msgRef = doc(db, 'dmRooms', roomId, 'messages', msgId);
  await updateDoc(msgRef, { deletedAt: serverTimestamp(), text: '삭제된 메시지입니다.', imageUrl: null, fileUrl: null, fileName: null });
}

export async function toggleDmReaction(roomId, msgId, emoji, userId) {
  const msgRef = doc(db, 'dmRooms', roomId, 'messages', msgId);
  const snap = await getDoc(msgRef);
  const reactions = snap.data()?.reactions || {};
  const users = reactions[emoji] || [];
  const next = users.includes(userId) ? users.filter((u) => u !== userId) : [...users, userId];
  await updateDoc(msgRef, { [`reactions.${emoji}`]: next });
}

export function subscribeDmRooms(userId, callback) {
  const q = query(DM_ROOMS, where('participants', 'array-contains', userId), orderBy('lastMessageAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // 숨김 처리된 방은 필터링 (상대가 이후 새 메시지 보내면 송신 시 hiddenBy를 비워 다시 표시)
    const visible = rooms.filter((r) => !(Array.isArray(r.hiddenBy) && r.hiddenBy.includes(userId)));
    callback(visible);
  });
}

// 1:1 대화방을 현재 사용자에게만 숨기기 (상대방에게는 그대로 보임)
export async function hideDmRoomForUser(roomId, userId) {
  await updateDoc(doc(DM_ROOMS, roomId), {
    hiddenBy: arrayUnion(userId),
  });
}

// 관리자 — 모든 1:1 대화의 메시지 전체 삭제 (방 자체는 유지, lastMessage/lastMessageAt/hiddenBy 리셋)
// 반환: { rooms, deletedMessages }
export async function clearAllDmMessages() {
  const roomsSnap = await getDocs(DM_ROOMS);
  let deletedMessages = 0;
  for (const roomDoc of roomsSnap.docs) {
    const msgRef = collection(db, 'dmRooms', roomDoc.id, 'messages');
    const msgsSnap = await getDocs(msgRef);
    await Promise.all(msgsSnap.docs.map((m) => deleteDoc(doc(db, 'dmRooms', roomDoc.id, 'messages', m.id))));
    deletedMessages += msgsSnap.size;
    await updateDoc(doc(DM_ROOMS, roomDoc.id), {
      lastMessage: '',
      lastMessageAt: null,
      lastSenderId: null,
      hiddenBy: [],
    });
  }
  return { rooms: roomsSnap.size, deletedMessages };
}
