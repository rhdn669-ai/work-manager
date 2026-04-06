import {
  collection, getDocs, addDoc, deleteDoc, updateDoc, doc,
  query, where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getToday } from '../utils/dateUtils';

const overtimeRef = collection(db, 'overtimeRecords');

// 잔업 등록 (지난 날짜면 승인 필요)
export async function addOvertimeRecord(data) {
  const today = getToday();
  const isPast = data.date < today;
  return addDoc(overtimeRef, {
    userId: data.userId,
    userName: data.userName,
    departmentId: data.departmentId,
    date: data.date,
    minutes: data.minutes,
    reason: data.reason || '',
    status: isPast ? 'pending' : 'approved',
    createdAt: new Date(),
  });
}

// 잔업 삭제
export async function deleteOvertimeRecord(id) {
  await deleteDoc(doc(db, 'overtimeRecords', id));
}

// 잔업 승인
export async function approveOvertimeRecord(id) {
  await updateDoc(doc(db, 'overtimeRecords', id), { status: 'approved' });
}

// 잔업 거절
export async function rejectOvertimeRecord(id) {
  await updateDoc(doc(db, 'overtimeRecords', id), { status: 'rejected' });
}

// 승인 대기 잔업 조회 (부서별)
export async function getPendingOvertimeRecords(departmentId) {
  const q = query(overtimeRef, where('status', '==', 'pending'));
  const snapshot = await getDocs(q);
  const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (departmentId) return all.filter((r) => r.departmentId === departmentId);
  return all;
}

// 본인 잔업 기록 조회 (기간별)
export async function getMyOvertimeRecords(userId, startDate, endDate) {
  const q = query(overtimeRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// 부서별 잔업 기록 조회
export async function getDepartmentOvertimeRecords(departmentId, startDate, endDate) {
  const q = query(overtimeRef, where('departmentId', '==', departmentId));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// 전체 잔업 기록 조회 (관리자)
export async function getAllOvertimeRecords(startDate, endDate) {
  const snapshot = await getDocs(overtimeRef);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => b.date.localeCompare(a.date));
}
