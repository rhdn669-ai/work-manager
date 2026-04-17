import {
  collection, getDocs, getDoc, addDoc, deleteDoc, updateDoc, doc,
  query, where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getToday } from '../utils/dateUtils';
import { getUser } from './userService';
import { addFinanceItem } from './siteService';

const overtimeRef = collection(db, 'overtimeRecords');

// 잔업 등록 (지난 날짜면 승인 필요)
export async function addOvertimeRecord(data) {
  const today = getToday();
  const isPast = data.date < today;
  const status = isPast ? 'pending' : 'approved';
  const docRef = await addDoc(overtimeRef, {
    userId: data.userId,
    userName: data.userName,
    departmentId: data.departmentId,
    siteId: data.siteId || '',
    date: data.date,
    minutes: data.minutes,
    reason: data.reason || '',
    status,
    createdAt: new Date(),
  });
  // 당일/미래 잔업은 바로 승인이므로 프로젝트 지출 반영
  if (status === 'approved' && data.siteId) {
    await addOvertimeExpense(data.userId, data.userName, data.siteId, data.date, data.minutes);
  }
  return docRef;
}

// 잔업 삭제
export async function deleteOvertimeRecord(id) {
  await deleteDoc(doc(db, 'overtimeRecords', id));
}

// 잔업 승인
export async function approveOvertimeRecord(id) {
  await updateDoc(doc(db, 'overtimeRecords', id), { status: 'approved' });
  // 프로젝트 지출 반영
  const snap = await getDoc(doc(db, 'overtimeRecords', id));
  if (snap.exists()) {
    const rec = snap.data();
    if (rec.siteId) {
      await addOvertimeExpense(rec.userId, rec.userName, rec.siteId, rec.date, rec.minutes);
    }
  }
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

// 전체 잔업 기록 + 자동 생성된 지출 항목(잔업) 삭제
export async function resetAllOvertimes() {
  const otSnap = await getDocs(overtimeRef);
  await Promise.all(otSnap.docs.map((d) => deleteDoc(doc(db, 'overtimeRecords', d.id))));

  const finSnap = await getDocs(collection(db, 'siteFinances'));
  const targets = finSnap.docs.filter((f) => {
    const desc = (f.data().description || '').trim();
    return desc === '잔업' || desc.startsWith('잔업 -') || desc.startsWith('잔업-');
  });
  await Promise.all(targets.map((f) => deleteDoc(doc(db, 'siteFinances', f.id))));

  return { overtimesDeleted: otSnap.size, expensesDeleted: targets.length };
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
