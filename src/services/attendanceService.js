import {
  collection, doc, getDocs, addDoc, updateDoc,
  query, where, orderBy, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { DAILY_WORK_MINUTES, LUNCH_BREAK_MINUTES, LUNCH_BREAK_THRESHOLD } from '../utils/constants';
import { getToday } from '../utils/dateUtils';

const attendRef = collection(db, 'attendances');

// 오늘 출퇴근 기록 조회
export async function getTodayAttendance(userId) {
  const today = getToday();
  const q = query(attendRef, where('userId', '==', userId), where('date', '==', today));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const d = snapshot.docs[0];
  return { id: d.id, ...d.data() };
}

// 출근 기록
export async function checkIn(userId, departmentId) {
  const today = getToday();
  // 이미 출근 기록이 있는지 확인
  const existing = await getTodayAttendance(userId);
  if (existing) throw new Error('이미 출근 기록이 있습니다');

  return addDoc(attendRef, {
    userId,
    departmentId,
    date: today,
    checkIn: Timestamp.now(),
    checkOut: null,
    workMinutes: null,
    overtimeMinutes: null,
    status: 'working',
    note: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// 퇴근 기록
export async function checkOut(attendanceId, checkInTime) {
  const now = Timestamp.now();
  const checkInDate = checkInTime.toDate ? checkInTime.toDate() : new Date(checkInTime);
  const nowDate = now.toDate();

  let totalMinutes = Math.round((nowDate - checkInDate) / 60000);

  // 6시간 이상 근무 시 점심시간 차감
  if (totalMinutes >= LUNCH_BREAK_THRESHOLD) {
    totalMinutes -= LUNCH_BREAK_MINUTES;
  }

  const overtimeMinutes = Math.max(0, totalMinutes - DAILY_WORK_MINUTES);

  await updateDoc(doc(db, 'attendances', attendanceId), {
    checkOut: now,
    workMinutes: totalMinutes,
    overtimeMinutes,
    status: 'completed',
    updatedAt: serverTimestamp(),
  });

  return { workMinutes: totalMinutes, overtimeMinutes };
}

// 기간별 출퇴근 기록 조회 (본인)
export async function getAttendanceByRange(userId, startDate, endDate) {
  const q = query(
    attendRef,
    where('userId', '==', userId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 부서별 오늘 출퇴근 현황
export async function getDepartmentTodayAttendance(departmentId) {
  const today = getToday();
  const q = query(
    attendRef,
    where('departmentId', '==', departmentId),
    where('date', '==', today)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 부서별 기간 출퇴근 기록
export async function getDepartmentAttendanceByRange(departmentId, startDate, endDate) {
  const q = query(
    attendRef,
    where('departmentId', '==', departmentId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}
