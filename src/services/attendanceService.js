import {
  collection, getDocs, getDoc, addDoc, deleteDoc, updateDoc, doc,
  query, where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getToday } from '../utils/dateUtils';
import { getUser } from './userService';
import { addFinanceItem, deleteFinanceItem, findFinanceByOvertimeId, getFinanceItems, updateFinanceItem } from './siteService';

const overtimeRef = collection(db, 'overtimeRecords');

// 잔업 등록 (당일/미래: 즉시 확정, 지난 날짜: 관리자 승인 대기)
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
  if (status === 'approved' && data.siteId && data.siteId !== 'etc') {
    await addOvertimeExpense(data.userId, data.userName, data.siteId, data.date, data.minutes, docRef.id);
  }
  return docRef;
}

// 잔업 승인 (관리자) - 지출 반영
export async function approveOvertimeRecord(id) {
  const snap = await getDoc(doc(db, 'overtimeRecords', id));
  if (!snap.exists()) return;
  const rec = snap.data();
  await updateDoc(doc(db, 'overtimeRecords', id), { status: 'approved', updatedAt: new Date() });
  if (rec.siteId && rec.siteId !== 'etc') {
    await addOvertimeExpense(rec.userId, rec.userName, rec.siteId, rec.date, rec.minutes, id);
  }
}

// 잔업 거절 (관리자) - 기존 지출 제거
export async function rejectOvertimeRecord(id) {
  const snap = await getDoc(doc(db, 'overtimeRecords', id));
  const prev = snap.exists() ? snap.data() : null;
  await updateDoc(doc(db, 'overtimeRecords', id), { status: 'rejected', updatedAt: new Date() });
  await removeOvertimeExpense(id, prev);
}

// 승인 대기 잔업 전체 조회 (관리자용)
export async function getPendingOvertimeRecords() {
  const q = query(overtimeRef, where('status', '==', 'pending'));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

// 잔업 삭제 - 연관된 프로젝트 지출도 함께 제거
export async function deleteOvertimeRecord(id) {
  const snap = await getDoc(doc(db, 'overtimeRecords', id));
  const prev = snap.exists() ? snap.data() : null;
  await removeOvertimeExpense(id, prev);
  await deleteDoc(doc(db, 'overtimeRecords', id));
}

// 잔업 개별 수정 (관리자용) - 프로젝트 지출도 함께 갱신
export async function updateOvertimeRecord(id, data) {
  const snap = await getDoc(doc(db, 'overtimeRecords', id));
  if (!snap.exists()) return;
  const prev = snap.data();

  const update = { updatedAt: new Date() };
  if (data.minutes !== undefined) update.minutes = data.minutes;
  if (data.reason !== undefined) update.reason = data.reason;
  if (data.date !== undefined) update.date = data.date;
  if (data.siteId !== undefined) update.siteId = data.siteId;
  await updateDoc(doc(db, 'overtimeRecords', id), update);

  // 프로젝트 지출 동기화
  const newSiteId = data.siteId !== undefined ? data.siteId : prev.siteId;
  const newDate = data.date !== undefined ? data.date : prev.date;
  const newMinutes = data.minutes !== undefined ? data.minutes : prev.minutes;

  await removeOvertimeExpense(id, prev);

  // 새 지출 항목 생성 (새 프로젝트에)
  if (newSiteId && newSiteId !== 'etc') {
    await addOvertimeExpense(prev.userId, prev.userName, newSiteId, newDate, newMinutes, id);
  }
}

// 잔업 record id / 폴백(description 매칭)으로 지출 항목 제거
async function removeOvertimeExpense(overtimeId, record) {
  let finances = await findFinanceByOvertimeId(overtimeId);
  if (finances.length === 0 && record?.siteId && record.siteId !== 'etc' && record.date) {
    const d = new Date(record.date);
    const all = await getFinanceItems(record.siteId, d.getFullYear(), d.getMonth() + 1);
    finances = all.filter((f) => f.description && f.description.includes('잔업') && f.description.includes(record.userName) && f.description.includes(record.date));
  }
  for (const f of finances) {
    await deleteFinanceItem(f.id);
  }
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

// 잔업 비용을 프로젝트 지출에 추가 (시급의 1.5배 적용)
export const OVERTIME_MULTIPLIER = 1.5;
async function addOvertimeExpense(userId, userName, siteId, date, minutes, overtimeRecordId) {
  const user = await getUser(userId);
  const hourlyRate = Number(user?.hourlyRate) || 0;
  if (hourlyRate <= 0) return;
  const hours = minutes / 60;
  const amount = Math.round(hourlyRate * OVERTIME_MULTIPLIER * hours);
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  await addFinanceItem(siteId, year, month, {
    type: 'expense',
    description: `잔업 - ${userName} (${date}, ${Math.floor(hours)}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''})`,
    amount,
    note: '',
    order: 0,
    overtimeRecordId: overtimeRecordId || '',
  });
}

// 관리자: 승인된 모든 잔업의 지출 금액을 시급×1.5×시간 로직으로 일괄 재계산
// 시급이 변경되었거나 OVERTIME_MULTIPLIER가 바뀌었을 때 사용
export async function recomputeAllOvertimeExpenses() {
  const snap = await getDocs(overtimeRef);
  const approved = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.status === 'approved' && r.siteId && r.siteId !== 'etc');

  const stats = { total: approved.length, updated: 0, skipped: 0 };
  for (const rec of approved) {
    try {
      const user = await getUser(rec.userId);
      const hourlyRate = Number(user?.hourlyRate) || 0;
      if (hourlyRate <= 0) { stats.skipped++; continue; }
      const hours = (rec.minutes || 0) / 60;
      const newAmount = Math.round(hourlyRate * OVERTIME_MULTIPLIER * hours);

      const fins = await findFinanceByOvertimeId(rec.id);
      if (fins.length === 0) { stats.skipped++; continue; }
      for (const f of fins) {
        if (Number(f.amount) !== newAmount) {
          await updateFinanceItem(f.id, { amount: newAmount });
          stats.updated++;
        }
      }
    } catch (err) {
      console.error('잔업 재계산 실패:', rec.id, err);
      stats.skipped++;
    }
  }
  return stats;
}
