import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const tasksRef = collection(db, 'tasks');

const ms = (x) => (x?.toDate ? x.toDate().getTime() : x ? new Date(x).getTime() : 0);

// 회사 주요업무 보드 — 전체 업무 조회 (컬럼 내 order, 그다음 생성 최신순)
export async function getTasks() {
  const snap = await getDocs(tasksRef);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || ms(b.createdAt) - ms(a.createdAt));
  return list;
}

export async function addTask(data) {
  return addDoc(tasksRef, {
    title: data.title || '',
    status: data.status || 'todo',
    assigneeId: data.assigneeId || '',
    assigneeName: data.assigneeName || '',
    dueDate: data.dueDate || '',
    priority: data.priority || 'normal',
    memo: data.memo || '',
    createdAt: new Date(),
    order: data.order ?? Date.now(),
  });
}

export async function updateTask(id, data) {
  return updateDoc(doc(db, 'tasks', id), { ...data, updatedAt: new Date() });
}

export async function setTaskStatus(id, status) {
  return updateDoc(doc(db, 'tasks', id), { status, updatedAt: new Date() });
}

export async function deleteTask(id) {
  return deleteDoc(doc(db, 'tasks', id));
}
