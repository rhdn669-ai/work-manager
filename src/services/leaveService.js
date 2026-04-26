import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { calculateAccruedLeave } from '../utils/leaveCalculator';
import { getUser } from './userService';
import { syncEmployeeLeaveDaysForMonth } from './siteService';
import { QUARTER_LEAVE_TYPES } from '../utils/constants';

const leavesRef = collection(db, 'leaves');
const balancesRef = collection(db, 'leaveBalances');

// 같은 날 복수 연차 시 더 강한 유형 우선 (annual/sick > 반차 > 반반차)
function _typeRank(t) {
  if (!t || t === 'annual' || t === 'sick') return 3;
  if (t === 'half_am' || t === 'half_pm') return 2;
  if (QUARTER_LEAVE_TYPES.includes(t)) return 1;
  return 0;
}

// 날짜 범위가 걸치는 모든 (year, month) 조합
function _getAffectedMonths(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months = new Map();
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${cur.getMonth() + 1}`;
    months.set(key, { year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return [...months.values()];
}

// 유저의 해당 월 (day → leaveType) 맵 구성 (confirmed 상태만)
async function _buildUserLeaveDaysMap(userId, year, month) {
  const q = query(leavesRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const userLeaves = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l.status === 'confirmed' && l.endDate >= monthStart && l.startDate <= monthEnd);

  const map = {};
  for (const leave of userLeaves) {
    const start = new Date(leave.startDate);
    const end = new Date(leave.endDate);
    const cur = new Date(start);
    while (cur <= end) {
      if (cur.getFullYear() === year && cur.getMonth() + 1 === month) {
        const day = cur.getDate();
        if (!map[day] || _typeRank(leave.type) > _typeRank(map[day])) {
          map[day] = leave.type || 'annual';
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

// 연차 변경 후 공수표 dailyQuantities를 자동 동기화
// ranges: [{ startDate, endDate }, ...] — 이전 기간과 새 기간 둘 다 전달 가능
async function _reconcileLeaveToSiteClosings(userId, ranges) {
  try {
    const user = await getUser(userId);
    if (!user?.name) return;
    const monthKeys = new Set();
    for (const r of ranges) {
      for (const { year, month } of _getAffectedMonths(r.startDate, r.endDate)) {
        monthKeys.add(`${year}-${month}`);
      }
    }
    for (const key of monthKeys) {
      const [y, mo] = key.split('-').map(Number);
      const leaveMap = await _buildUserLeaveDaysMap(userId, y, mo);
      await syncEmployeeLeaveDaysForMonth(user.name, y, mo, leaveMap);
    }
  } catch (err) {
    console.error('연차→공수표 동기화 실패:', err);
  }
}

// 연차 신청 (바로 사용 확정 + 잔여 차감)
export async function requestLeave(data) {
  const docRef = await addDoc(leavesRef, {
    userId: data.userId,
    departmentId: data.departmentId,
    type: data.type,
    startDate: data.startDate,
    endDate: data.endDate,
    days: data.days,
    reason: data.reason || '',
    status: 'confirmed',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // 잔여 연차 차감
  await updateLeaveBalance(data.userId, data.days);
  // 공수표 자동 동기화
  await _reconcileLeaveToSiteClosings(data.userId, [{ startDate: data.startDate, endDate: data.endDate }]);
  return docRef;
}


// 연차 취소 (선택적으로 취소 사유 기록)
export async function cancelLeave(leaveId, cancelReason = '') {
  const leaveDoc = await getDoc(doc(db, 'leaves', leaveId));
  if (!leaveDoc.exists()) throw new Error('신청을 찾을 수 없습니다');
  const leave = leaveDoc.data();

  await updateDoc(doc(db, 'leaves', leaveId), {
    status: 'cancelled',
    cancelReason: cancelReason || '',
    updatedAt: new Date(),
  });

  if (leave.status === 'confirmed') {
    await updateLeaveBalance(leave.userId, -leave.days);
  }
  // 공수표 자동 동기화 (출근 복원)
  await _reconcileLeaveToSiteClosings(leave.userId, [{ startDate: leave.startDate, endDate: leave.endDate }]);
}

// 사용 중인 연차 목록 (월 기준, 전체 사용자)
export async function getApprovedLeavesByMonth(year, month) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const snapshot = await getDocs(leavesRef);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l.status === 'confirmed' && l.endDate >= monthStart && l.startDate <= monthEnd);
}

// 모든 사용자의 연차 신청 목록 (관리자 전용, 연도 기준, 모든 상태)
export async function getAllLeavesByYear(year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const snapshot = await getDocs(leavesRef);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l.startDate >= startDate && l.startDate <= endDate)
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

// 본인 연차 신청 목록 (복합 인덱스 회피: 클라이언트 필터/정렬)
export async function getMyLeaves(userId, year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const q = query(leavesRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => l.startDate >= startDate && l.startDate <= endDate)
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
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

// 연차 개별 삭제 (관리자용) - 삭제 시 usedDays 자동 복원
export async function deleteLeaveById(id) {
  const ref = doc(db, 'leaves', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const leave = snap.data();
  if (leave.status === 'confirmed') {
    await updateLeaveBalance(leave.userId, -(leave.days || 0));
  }
  await deleteDoc(ref);
  // 공수표 자동 동기화 (출근 복원)
  await _reconcileLeaveToSiteClosings(leave.userId, [{ startDate: leave.startDate, endDate: leave.endDate }]);
}

// 연차 수정 (관리자용)
export async function updateLeaveRecord(id, data) {
  const prevSnap = await getDoc(doc(db, 'leaves', id));
  const prev = prevSnap.exists() ? prevSnap.data() : null;
  const update = { updatedAt: new Date() };
  if (data.reason !== undefined) update.reason = data.reason;
  if (data.startDate !== undefined) update.startDate = data.startDate;
  if (data.endDate !== undefined) update.endDate = data.endDate;
  if (data.days !== undefined) update.days = data.days;
  if (data.type !== undefined) update.type = data.type;
  await updateDoc(doc(db, 'leaves', id), update);

  if (prev?.userId) {
    const oldStart = prev.startDate;
    const oldEnd = prev.endDate;
    const newStart = data.startDate !== undefined ? data.startDate : prev.startDate;
    const newEnd = data.endDate !== undefined ? data.endDate : prev.endDate;
    await _reconcileLeaveToSiteClosings(prev.userId, [
      { startDate: oldStart, endDate: oldEnd },
      { startDate: newStart, endDate: newEnd },
    ]);
  }
}

// 하위 호환
export async function updateLeaveReason(id, reason) {
  await updateLeaveRecord(id, { reason });
}

// 직원 당일 수정 (일수 변경 시 잔여 연차 자동 조정)
export async function editLeaveWithBalance(id, userId, data, oldDays) {
  await updateLeaveRecord(id, data);
  const diff = (data.days ?? oldDays) - oldDays;
  if (diff !== 0) await updateLeaveBalance(userId, diff);
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
