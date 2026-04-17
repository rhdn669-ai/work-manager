import {
  collection, getDocs, addDoc, deleteDoc, updateDoc, doc,
  query, where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getUser } from './userService';
import { addFinanceItem } from './siteService';

const overtimeRef = collection(db, 'overtimeRecords');

// 잔업 등록 (즉시 확정, 프로젝트 지출 바로 반영)
export async function addOvertimeRecord(data) {
  const docRef = await addDoc(overtimeRef, {
    userId: data.userId,
    userName: data.userName,
    departmentId: data.departmentId,
    siteId: data.siteId || '',
    date: data.date,
    minutes: data.minutes,
    reason: data.reason || '',
    status: 'approved',
    createdAt: new Date(),
  });
  if (data.siteId && data.siteId !== 'etc') {
    await addOvertimeExpense(data.userId, data.userName, data.siteId, data.date, data.minutes);
  }
  return docRef;
}

// 잔업 삭제
export async function deleteOvertimeRecord(id) {
  await deleteDoc(doc(db, 'overtimeRecords', id));
}

// 잔업 개별 수정 (관리자용) - 분/비고만 편집 (지출 재계산은 하지 않음)
export async function updateOvertimeRecord(id, data) {
  await updateDoc(doc(db, 'overtimeRecords', id), {
    minutes: data.minutes,
    reason: data.reason || '',
    updatedAt: new Date(),
  });
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

// 잔업 비용을 프로젝트 지출에 추가
async function addOvertimeExpense(userId, userName, siteId, date, minutes) {
  const user = await getUser(userId);
  const hourlyRate = Number(user?.hourlyRate) || 0;
  if (hourlyRate <= 0) return;
  const hours = minutes / 60;
  const amount = Math.round(hourlyRate * hours);
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  await addFinanceItem(siteId, year, month, {
    type: 'expense',
    description: `잔업 - ${userName} (${date}, ${Math.floor(hours)}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''})`,
    amount,
    note: '',
    order: 0,
  });
}
