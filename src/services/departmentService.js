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

// 내가 팀장(managerId)인 팀 목록
export async function getDepartmentsByLeader(uid) {
  const q = query(deptRef, where('managerId', '==', uid));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addDepartment(data) {
  return addDoc(deptRef, {
    name: data.name,
    managerId: data.managerId || '',
    createdAt: new Date(),
  });
}

export async function updateDepartment(id, data) {
  await updateDoc(doc(db, 'departments', id), data);
}

export async function deleteDepartment(id) {
  await deleteDoc(doc(db, 'departments', id));
}
