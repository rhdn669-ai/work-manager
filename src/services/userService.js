import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const usersRef = collection(db, 'users');

// uid는 항상 문서 ID로 강제 (기존 데이터 호환)
export async function getUsers() {
  const q = query(usersRef, orderBy('code'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id, uid: d.id }));
}

export async function getUsersByDepartment(departmentId) {
  const q = query(usersRef, where('departmentId', '==', departmentId), orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ ...d.data(), id: d.id, uid: d.id }));
}

export async function getUser(uid) {
  const docSnap = await getDoc(doc(db, 'users', uid));
  return docSnap.exists() ? { ...docSnap.data(), id: docSnap.id, uid: docSnap.id } : null;
}

export async function updateUser(uid, data) {
  await updateDoc(doc(db, 'users', uid), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function createUser(uid, data) {
  await setDoc(doc(db, 'users', uid), {
    uid,
    ...data,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function deleteUser(uid) {
  await deleteDoc(doc(db, 'users', uid));
}

// 코드(사번)로 사용자 조회 — 비밀번호 찾기 흐름에서 사용
export async function getUserByCode(code) {
  const q = query(usersRef, where('code', '==', String(code)));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const d = snapshot.docs[0];
  return { ...d.data(), id: d.id, uid: d.id };
}

// 비밀번호 찾기 시도 횟수 갱신 — 실패 시 wrongAttempts++, 5회 누적 시 lockedUntil 설정 (30분)
export async function recordWrongHintAttempt(uid) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  const cur = snap.exists() ? snap.data() : {};
  const wrong = Number(cur.wrongHintAttempts || 0) + 1;
  const updates = { wrongHintAttempts: wrong, updatedAt: new Date() };
  if (wrong >= 5) {
    updates.hintLockedUntil = Date.now() + 30 * 60 * 1000; // 30분 잠금
  }
  await updateDoc(userRef, updates);
  return { wrongAttempts: wrong, locked: wrong >= 5 };
}

// 성공 시 시도 카운터 리셋
export async function resetHintAttempts(uid) {
  await updateDoc(doc(db, 'users', uid), {
    wrongHintAttempts: 0,
    hintLockedUntil: 0,
    updatedAt: new Date(),
  });
}
