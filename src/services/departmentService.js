import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const deptRef = collection(db, 'departments');

export async function getDepartments() {
  const q = query(deptRef, orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 내가 팀장(managerId) 또는 부팀장(subManagerId)인 팀 목록
export async function getDepartmentsByLeader(uid) {
  const [mainSnap, subSnap] = await Promise.all([
    getDocs(query(deptRef, where('managerId', '==', uid))),
    getDocs(query(deptRef, where('subManagerId', '==', uid))),
  ]);
  const map = new Map();
  for (const d of mainSnap.docs) map.set(d.id, { id: d.id, ...d.data() });
  for (const d of subSnap.docs) map.set(d.id, { id: d.id, ...d.data() });
  return [...map.values()];
}

export async function addDepartment(data) {
  return addDoc(deptRef, {
    name: data.name,
    managerId: data.managerId || '',
    subManagerId: data.subManagerId || '',
    createdAt: new Date(),
  });
}

export async function updateDepartment(id, data) {
  await updateDoc(doc(db, 'departments', id), data);
}

export async function deleteDepartment(id) {
  await deleteDoc(doc(db, 'departments', id));
}
