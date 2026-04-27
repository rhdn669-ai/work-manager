import { doc, onSnapshot, setDoc, updateDoc, getDoc, deleteField } from 'firebase/firestore';
import { db } from '../config/firebase';

const COLL = 'userPreferences';

function refFor(uid) {
  return doc(db, COLL, uid);
}

export function subscribePreferences(uid, callback) {
  if (!uid) return () => {};
  return onSnapshot(
    refFor(uid),
    (snap) => callback(snap.exists() ? snap.data() : {}),
    () => callback({}),
  );
}

export async function getPreferences(uid) {
  if (!uid) return {};
  const snap = await getDoc(refFor(uid));
  return snap.exists() ? snap.data() : {};
}

export async function setSidebarPref(uid, pref) {
  if (!uid) return;
  await setDoc(refFor(uid), { sidebar: pref, updatedAt: new Date() }, { merge: true });
}

export async function clearSidebarPref(uid) {
  if (!uid) return;
  await setDoc(refFor(uid), { sidebar: deleteField(), updatedAt: new Date() }, { merge: true });
}

// 채팅 읽음: 단일 방 갱신 — dot 표기로 nested map 업데이트
export async function setChatRead(uid, kind, roomId, { count, ts }) {
  if (!uid || !kind || !roomId) return;
  const key = `chatReads.${kind}_${roomId}`;
  try {
    await updateDoc(refFor(uid), {
      [key]: { count: Number(count) || 0, ts: Number(ts) || Date.now() },
      updatedAt: new Date(),
    });
  } catch {
    // 문서 자체가 없는 첫 호출이면 setDoc(merge)로 생성
    await setDoc(
      refFor(uid),
      { chatReads: { [`${kind}_${roomId}`]: { count: Number(count) || 0, ts: Number(ts) || Date.now() } }, updatedAt: new Date() },
      { merge: true },
    );
  }
}

// 채팅 읽음: 여러 방 한번에 (전체 읽음 처리용)
export async function setChatReadBulk(uid, entries) {
  if (!uid || !entries || entries.length === 0) return;
  const map = {};
  for (const { kind, roomId, count, ts } of entries) {
    if (!kind || !roomId) continue;
    map[`${kind}_${roomId}`] = { count: Number(count) || 0, ts: Number(ts) || Date.now() };
  }
  await setDoc(refFor(uid), { chatReads: map, updatedAt: new Date() }, { merge: true });
}

export async function clearChatReads(uid) {
  if (!uid) return;
  await setDoc(refFor(uid), { chatReads: deleteField(), updatedAt: new Date() }, { merge: true });
}
