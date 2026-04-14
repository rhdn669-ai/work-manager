import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { calculateAccruedLeave } from '../utils/leaveCalculator';
import { getUser } from './userService';

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

// 승인된 연차 목록 (월 기준, 전체 사용자)
export async function getApprovedLeavesByMonth(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const q = query(
    leavesRef,
    where('status', '==', 'approved'),
    where('startDate', '<=', endDate),
    where('startDate', '>=', startDate),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
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

// 전사 연차 신청 목록 (승인 대기) — 대표/부사장/관리자용
export async function getAllPendingLeaves() {
  const q = query(
    leavesRef,
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 잔여 연차 조회 (users 컬렉션의 입사일 기준 실시간 계산)
export async function getLeaveBalance(userId) {
  // users 컬렉션에서 최신 입사일을 직접 가져옴
  const user = await getUser(userId);
  if (!user || !user.joinDate) return null;

  const joinDate = user.joinDate;
  const totalDays = calculateAccruedLeave(joinDate);

  const docSnap = await getDoc(doc(db, 'leaveBalances', userId));
  const usedDays = docSnap.exists() ? (docSnap.data().usedDays || 0) : 0;

  // leaveBalances 문서가 없으면 자동 생성
  if (!docSnap.exists()) {
    await setDoc(doc(db, 'leaveBalances', userId), {
      userId,
      joinDate,
      usedDays: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return {
    id: userId,
    userId,
    joinDate,
    totalDays,
    usedDays,
    remainingDays: totalDays - usedDays,
  };
}

// 연차 잔여 갱신 (days: 양수=사용, 음수=복원)
async function updateLeaveBalance(userId, days) {
  const docSnap = await getDoc(doc(db, 'leaveBalances', userId));

  if (docSnap.exists()) {
    const data = docSnap.data();
    await updateDoc(doc(db, 'leaveBalances', userId), {
      usedDays: (data.usedDays || 0) + days,
      updatedAt: new Date(),
    });
  }
}

// 관리자: 현재 시점 잔여 연차 직접 설정 (usedDays 역산)
// 이후 시간이 지나면 자동으로 발생분이 누적되어 잔여가 증가
export async function setLeaveRemaining(userId, remaining) {
  const user = await getUser(userId);
  if (!user || !user.joinDate) {
    throw new Error('입사일 정보가 없습니다. 직원 관리에서 입사일을 등록하세요.');
  }
  const accrued = calculateAccruedLeave(user.joinDate);
  const usedDays = accrued - remaining;
  const ref = doc(db, 'leaveBalances', userId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(ref, { usedDays, updatedAt: new Date() });
  } else {
    await setDoc(ref, { userId, joinDate: user.joinDate, usedDays, createdAt: new Date(), updatedAt: new Date() });
  }
}

// 입사일 동기화/초기화 (users.joinDate를 balance에 스냅샷 저장)
// 기존 usedDays는 보존
export async function initLeaveBalance(userId, joinDate) {
  const ref = doc(db, 'leaveBalances', userId);
  const existing = await getDoc(ref);
  const usedDays = existing.exists() ? (existing.data().usedDays || 0) : 0;

  await setDoc(ref, {
    userId,
    joinDate,
    usedDays,
    createdAt: existing.exists() && existing.data().createdAt ? existing.data().createdAt : new Date(),
    updatedAt: new Date(),
  });
}
