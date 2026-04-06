import {
  collection, getDocs, addDoc, deleteDoc, doc,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const overtimeRef = collection(db, 'overtimeRecords');

// 잔업 등록
export async function addOvertimeRecord(data) {
  return addDoc(overtimeRef, {
    userId: data.userId,
    userName: data.userName,
    departmentId: data.departmentId,
    date: data.date,
    minutes: data.minutes,
    reason: data.reason || '',
    createdAt: serverTimestamp(),
  });
}

// 잔업 삭제
export async function deleteOvertimeRecord(id) {
  await deleteDoc(doc(db, 'overtimeRecords', id));
}

// 본인 잔업 기록 조회 (기간별)
export async function getMyOvertimeRecords(userId, startDate, endDate) {
  const q = query(
    overtimeRef,
    where('userId', '==', userId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 부서별 잔업 기록 조회
export async function getDepartmentOvertimeRecords(departmentId, startDate, endDate) {
  const q = query(
    overtimeRef,
    where('departmentId', '==', departmentId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 전체 잔업 기록 조회 (관리자)
export async function getAllOvertimeRecords(startDate, endDate) {
  const q = query(
    overtimeRef,
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}
