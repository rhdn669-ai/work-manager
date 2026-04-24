import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, limit, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
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
    await updateDoc(roomRef, {}).catch(async () => {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(roomRef, {
        participants: [uid1, uid2],
        names: { [uid1]: name1, [uid2]: name2 },
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        unread: { [uid1]: 0, [uid2]: 0 },
        createdAt: serverTimestamp(),
      });
    });
  }
  return roomId;
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
  await updateDoc(doc(DM_ROOMS, roomId), { lastMessage: text, lastMessageAt: serverTimestamp() });
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
  await updateDoc(doc(DM_ROOMS, roomId), { lastMessage: '사진', lastMessageAt: serverTimestamp() });
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
  await updateDoc(doc(DM_ROOMS, roomId), { lastMessage: `📎 ${file.name}`, lastMessageAt: serverTimestamp() });
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
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
