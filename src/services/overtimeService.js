import {
  collection, doc, getDocs, setDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getWeekStart, getWeekEnd } from '../utils/dateUtils';
import { WEEKLY_OVERTIME_LIMIT } from '../utils/constants';

const overtimeRef = collection(db, 'overtimeSummaries');
const attendRef = collection(db, 'attendances');

// 주간 초과근무 요약 갱신
export async function updateWeeklySummary(userId, departmentId, date) {
  const weekStart = getWeekStart(date);
  const weekEnd = getWeekEnd(date);

  // 해당 주 출퇴근 기록 조회
  const q = query(
    attendRef,
    where('userId', '==', userId),
    where('date', '>=', weekStart),
    where('date', '<=', weekEnd),
    orderBy('date')
  );
  const snapshot = await getDocs(q);

  const dailyBreakdown = {};
  let totalOvertimeMinutes = 0;

  snapshot.docs.forEach((d) => {
    const data = d.data();
    if (data.overtimeMinutes) {
      dailyBreakdown[data.date] = data.overtimeMinutes;
      totalOvertimeMinutes += data.overtimeMinutes;
    }
  });

  const docId = `${userId}_${weekStart}`;
  await setDoc(doc(db, 'overtimeSummaries', docId), {
    userId,
    departmentId,
    weekStart,
    totalOvertimeMinutes,
    dailyBreakdown,
    isOverLimit: totalOvertimeMinutes > WEEKLY_OVERTIME_LIMIT,
    updatedAt: new Date(),
  });

  return { totalOvertimeMinutes, isOverLimit: totalOvertimeMinutes > WEEKLY_OVERTIME_LIMIT };
}

// 본인 주간 초과근무 조회
export async function getWeeklySummary(userId, date) {
  const weekStart = getWeekStart(date);
  const docId = `${userId}_${weekStart}`;
  const q = query(overtimeRef, where('userId', '==', userId), where('weekStart', '==', weekStart));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

// 기간별 초과근무 요약 목록
export async function getOvertimeSummaries(userId, startWeek, endWeek) {
  const q = query(
    overtimeRef,
    where('userId', '==', userId),
    where('weekStart', '>=', startWeek),
    where('weekStart', '<=', endWeek),
    orderBy('weekStart', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 부서별 주간 초과근무 현황
export async function getDepartmentOvertimeSummaries(departmentId, weekStart) {
  const q = query(
    overtimeRef,
    where('departmentId', '==', departmentId),
    where('weekStart', '==', weekStart)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 초과근무 경고 레벨 판단
export function getOvertimeWarningLevel(totalMinutes) {
  if (totalMinutes > WEEKLY_OVERTIME_LIMIT) return 'danger';  // 12시간 초과
  if (totalMinutes >= WEEKLY_OVERTIME_LIMIT * 0.83) return 'warning'; // 83% 이상
  if (totalMinutes >= WEEKLY_OVERTIME_LIMIT * 0.5) return 'caution';  // 50% 이상
  return 'safe';
}
