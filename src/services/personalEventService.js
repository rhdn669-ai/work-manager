import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const ref = collection(db, 'personalEvents');

// 특정 유저의 특정 월에 걸친 개인 일정 조회
export async function getMyPersonalEvents(userId, year, month) {
  if (!userId) return [];
  const q = query(ref, where('userId', '==', userId));
  const snap = await getDocs(q);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => (e.endDate || e.startDate) >= monthStart && e.startDate <= monthEnd);
}

export async function addPersonalEvent(data) {
  return addDoc(ref, {
    userId: data.userId,
    title: (data.title || '').trim(),
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    note: data.note || '',
    createdAt: serverTimestamp(),
  });
}

export async function updatePersonalEvent(id, data) {
  const update = { updatedAt: serverTimestamp() };
  if (data.title !== undefined) update.title = (data.title || '').trim();
  if (data.startDate !== undefined) update.startDate = data.startDate;
  if (data.endDate !== undefined) update.endDate = data.endDate;
  if (data.note !== undefined) update.note = data.note;
  await updateDoc(doc(db, 'personalEvents', id), update);
}

export async function deletePersonalEvent(id) {
  await deleteDoc(doc(db, 'personalEvents', id));
}
