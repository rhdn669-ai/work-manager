import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { calculateAccruedLeave } from '../utils/leaveCalculator';

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
    createdAt: new Date(),
    updatedAt: new Date(),
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
    approvedAt: new Date(),
    updatedAt: new Date(),
  });

  // 잔여 연차 차감
  await updateLeaveBalance(leave.userId, leave.days);
}

// 연차 거절
export async function rejectLeave(leaveId, reason) {
  await updateDoc(doc(db, 'leaves', leaveId), {
    status: 'rejected',
    rejectedReason: reason || '',
    updatedAt: new Date(),
  });
}

// 연차 취소
export async function cancelLeave(leaveId) {
  const leaveDoc = await getDoc(doc(db, 'leaves', leaveId));
  if (!leaveDoc.exists()) throw new Error('신청을 찾을 수 없습니다');
  const leave = leaveDoc.data();

  await updateDoc(doc(db, 'leaves', leaveId), {
    status: 'cancelled',
    updatedAt: new Date(),
  });

  // 승인된 연차였으면 잔여 연차 복원
  if (leave.status === 'approved') {
    await updateLeaveBalance(leave.userId, -leave.days);
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

// 잔여 연차 조회 (입사일~현재 누적 발생분 기준)
export async function getLeaveBalance(userId) {
  const docSnap = await getDoc(doc(db, 'leaveBalances', userId));
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
}

// 연차 잔여 갱신 (days: 양수=사용, 음수=복원)
async function updateLeaveBalance(userId, days) {
  const docSnap = await getDoc(doc(db, 'leaveBalances', userId));

  if (docSnap.exists()) {
    const data = docSnap.data();
    await updateDoc(doc(db, 'leaveBalances', userId), {
      usedDays: (data.usedDays || 0) + days,
      remainingDays: (data.remainingDays || 0) - days,
      updatedAt: new Date(),
    });
  }
}

// 연차 잔여 직접 수정 (관리자용)
export async function updateLeaveBalanceDirect(userId, data) {
  await setDoc(doc(db, 'leaveBalances', userId), {
    userId,
    totalDays: data.totalDays,
    usedDays: data.usedDays,
    remainingDays: data.remainingDays,
    updatedAt: new Date(),
  }, { merge: true });
}

// 연차 잔여 초기화/재계산 (입사일~현재 누적 발생분으로 세팅)
// 기존 사용량은 보존 (usedDays는 유지)
export async function initLeaveBalance(userId, joinDate) {
  const totalDays = calculateAccruedLeave(joinDate);
  const ref = doc(db, 'leaveBalances', userId);
  const existing = await getDoc(ref);
  const usedDays = existing.exists() ? (existing.data().usedDays || 0) : 0;

  await setDoc(ref, {
    userId,
    totalDays,
    usedDays,
    remainingDays: totalDays - usedDays,
    createdAt: existing.exists() ? existing.data().createdAt : new Date(),
    updatedAt: new Date(),
  });

  return totalDays;
}
