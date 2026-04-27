import { doc, onSnapshot, setDoc, getDoc, deleteField } from 'firebase/firestore';
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


// 관리자 기본 대분류 seed 완료 플래그 — 사용자가 삭제해도 재등장하지 않도록 저장
export async function setSeededAdminDefaults(uid) {
  if (!uid) return;
  await setDoc(refFor(uid), { didSeedAdminDefaults: true, updatedAt: new Date() }, { merge: true });
}
