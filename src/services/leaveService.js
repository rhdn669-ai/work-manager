import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc,
  query, where, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { calculateAnnualLeave } from '../utils/leaveCalculator';

const leavesRef = collection(db, 'leaves');
const balancesRef = collection(db, 'leaveBalances');

// 연차 신청
export async function requestLeave(data) {
  return addDoc(leavesRef, {
    userId: data.userId,
    departmentId: data.departmentId,
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate,
    days: data.days,
    reason: data.reason || '',
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// 연차 승인
export async function approveLeave(leaveId, approvedByUid) {
  const leaveDoc = await getDoc(doc(db, 'leaves', leaveId));
  if (!leaveDoc.exists()) throw new Error('신청을 찾을 수 없습니다');
  const leave = leaveDoc.data();

  await updateDoc(doc(db, 'leaves', leaveId), {
    status: 'approved',
    approvedBy: approvedByUid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 잔여 연차 차감
  const year = new Date(leave.startDate).getFullYear();
  await updateLeaveBalance(leave.userId, year, leave.days);
}

// 연차 거절
export async function rejectLeave(leaveId, reason) {
  await updateDoc(doc(db, 'leaves', leaveId), {
    status: 'rejected',
    rejectedReason: reason || '',
    updatedAt: serverTimestamp(),
  });
}

// 연차 취소
export async function cancelLeave(leaveId) {
  const leaveDoc = await getDoc(doc(db, 'leaves', leaveId));
  if (!leaveDoc.exists()) throw new Error('신청을 찾을 수 없습니다');
  const leave = leaveDoc.data();

  await updateDoc(doc(db, 'leaves', leaveId), {
    status: 'cancelled',
    updatedAt: serverTimestamp(),
  });

  // 승인된 연차였으면 잔여 연차 복원
  if (leave.status === 'approved') {
    const year = new Date(leave.startDate).getFullYear();
    await updateLeaveBalance(leave.userId, year, -leave.days);
  }
}

// 본인 연차 신청 목록
export async function getMyLeaves(userId, year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const q = query(
    leavesRef,
    where('userId', '==', userId),
    where('startDate', '>=', startDate),
    where('startDate', '<=', endDate),
    orderBy('startDate', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 부서별 연차 신청 목록 (승인 대기)
export async function getDepartmentPendingLeaves(departmentId) {
  const q = query(
    leavesRef,
    where('departmentId', '==', departmentId),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 잔여 연차 조회
export async function getLeaveBalance(userId, year) {
  const balanceId = `${userId}_${year}`;
  const docSnap = await getDoc(doc(db, 'leaveBalances', balanceId));
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
}

// 연차 잔여 갱신 (days: 양수=사용, 음수=복원)
async function updateLeaveBalance(userId, year, days) {
  const balanceId = `${userId}_${year}`;
  const docSnap = await getDoc(doc(db, 'leaveBalances', balanceId));

  if (docSnap.exists()) {
    const data = docSnap.data();
    await updateDoc(doc(db, 'leaveBalances', balanceId), {
      usedDays: data.usedDays + days,
      remainingDays: data.remainingDays - days,
      updatedAt: serverTimestamp(),
    });
  }
}

// 연차 잔여 초기화 (관리자가 연초에 실행)
export async function initLeaveBalance(userId, joinDate, year) {
  const totalDays = calculateAnnualLeave(joinDate, year);
  const balanceId = `${userId}_${year}`;

  await setDoc(doc(db, 'leaveBalances', balanceId), {
    userId,
    year,
    totalDays,
    usedDays: 0,
    remainingDays: totalDays,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return totalDays;
}
