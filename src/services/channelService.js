import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc,
  query, orderBy, limit, where, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';

// ── 채널 관리 ──────────────────────────────────────────
export async function ensureCompanyChannel() {
  const r = doc(db, 'channels', 'company');
  const snap = await getDoc(r);
  if (!snap.exists()) {
    await setDoc(r, { name: '전사 채팅', type: 'company', createdAt: serverTimestamp() });
  }
}

export async function ensureDeptChannel(deptId, deptName) {
  const r = doc(db, 'channels', `dept_${deptId}`);
  const snap = await getDoc(r);
  if (snap.exists()) {
    await updateDoc(r, { name: deptName });
  } else {
    await setDoc(r, { name: deptName, type: 'department', departmentId: deptId, createdAt: serverTimestamp() });
  }
}

export async function deleteDeptChannel(deptId) {
  await deleteDoc(doc(db, 'channels', `dept_${deptId}`));
}

export async function getAccessibleChannels(departmentId, canApproveAll) {
  const snap = await getDocs(collection(db, 'channels'));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  all.sort((a, b) => {
    if (a.type === 'company') return -1;
    if (b.type === 'company') return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  if (canApproveAll) return all;
  return all.filter((c) => c.type === 'company' || c.departmentId === departmentId);
}

// ── 채널 메시지 ────────────────────────────────────────
function msgCol(channelId) {
  return collection(db, 'channels', channelId, 'messages');
}

export function subscribeChannelMessages(channelId, callback) {
  const q = query(msgCol(channelId), orderBy('createdAt', 'asc'), limit(300));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function sendChannelMessage({ channelId, userId, userName, position, text, replyTo = null }) {
  return addDoc(msgCol(channelId), {
    userId, userName, position,
    text, type: 'text', replyTo,
    reactions: {}, readBy: { [userId]: Date.now() },
    isPinned: false, deletedAt: null, createdAt: serverTimestamp(),
  });
}

export async function sendChannelImage({ channelId, userId, userName, position, file, replyTo = null }) {
  const storageRef = ref(storage, `channels/${channelId}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const imageUrl = await getDownloadURL(storageRef);
  return addDoc(msgCol(channelId), {
    userId, userName, position,
    text: '', type: 'image', imageUrl, replyTo,
    reactions: {}, readBy: { [userId]: Date.now() },
    isPinned: false, deletedAt: null, createdAt: serverTimestamp(),
  });
}

export async function sendChannelFile({ channelId, userId, userName, position, file, replyTo = null }) {
  const storageRef = ref(storage, `channels/${channelId}/files/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const fileUrl = await getDownloadURL(storageRef);
  return addDoc(msgCol(channelId), {
    userId, userName, position,
    text: '', type: 'file', fileUrl, fileName: file.name, fileSize: file.size, replyTo,
    reactions: {}, readBy: { [userId]: Date.now() },
    isPinned: false, deletedAt: null, createdAt: serverTimestamp(),
  });
}

export async function deleteChannelMessage(channelId, msgId) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', msgId), {
    deletedAt: serverTimestamp(), text: '삭제된 메시지입니다.', imageUrl: null, fileUrl: null, fileName: null,
  });
}

export async function editChannelMessage(channelId, msgId, newText) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', msgId), {
    text: newText, editedAt: serverTimestamp(),
  });
}

export async function deleteAllChannelMessages(channelId) {
  const snap = await getDocs(msgCol(channelId));
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, 'channels', channelId, 'messages', d.id))));
}

export async function toggleChannelReaction(channelId, msgId, emoji, userId) {
  const msgDoc = doc(db, 'channels', channelId, 'messages', msgId);
  const snap = await getDoc(msgDoc);
  const reactions = snap.data()?.reactions || {};
  const users = reactions[emoji] || [];
  const next = users.includes(userId) ? users.filter((u) => u !== userId) : [...users, userId];
  await updateDoc(msgDoc, { [`reactions.${emoji}`]: next });
}

export async function pinChannelMessage(channelId, msgId, pin) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', msgId), {
    isPinned: pin, pinnedAt: pin ? serverTimestamp() : null,
  });
}

export async function getPinnedChannelMessage(channelId) {
  const q = query(msgCol(channelId), where('isPinned', '==', true), orderBy('pinnedAt', 'desc'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function markChannelRead(channelId, msgId, userId) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', msgId), {
    [`readBy.${userId}`]: Date.now(),
  });
}

export async function setChannelTyping(channelId, userId, userName, isTyping) {
  const { setDoc } = await import('firebase/firestore');
  await setDoc(
    doc(db, 'channels', channelId, 'typing', userId),
    { isTyping, userName, updatedAt: Date.now() },
    { merge: true }
  );
}

export function subscribeChannelTyping(channelId, myUserId, callback) {
  const typingCol = collection(db, 'channels', channelId, 'typing');
  return onSnapshot(typingCol, (snap) => {
    const now = Date.now();
    const typing = snap.docs
      .filter((d) => d.id !== myUserId && d.data().isTyping && now - d.data().updatedAt < 5000)
      .map((d) => d.data().userName);
    callback(typing);
  });
}
