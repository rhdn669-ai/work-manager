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

// 화면 배율 — 「보통」과 「크게」. 글자만이 아니라 여백·버튼까지 함께 커진다.
// 앱 곳곳에 글자 크기가 934곳 직접 박혀 있어 토큰만 바꿔서는 대부분이 안 따라온다.
// 배율은 브라우저가 화면 전체에 걸어 주므로 누락이 원리적으로 생기지 않는다 (2026-08-26 대표님).
export async function setUiScale(uid, scale) {
  if (!uid) return;
  await setDoc(refFor(uid), { uiScale: scale === 'lg' ? 'lg' : 'md', updatedAt: new Date() }, { merge: true });
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
