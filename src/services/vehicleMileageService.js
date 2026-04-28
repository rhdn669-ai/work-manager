import {
  collection, doc, getDoc, getDocs, setDoc,
  query, where, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// 차량 운행 키로수 — 사용자×월 단일 문서
// 컬렉션: vehicleMileages
// 문서 ID: `${uid}_${YYYY-MM}` (예: user_1234_2026-04)
// 데이터: { uid, userName, plate, yearMonth, year, month,
//          odometer, prevOdometer, drivenKm, recordedAt }

const colRef = collection(db, 'vehicleMileages');

function ymKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
function docId(uid, year, month) {
  return `${uid}_${ymKey(year, month)}`;
}

export async function getMileage(uid, year, month) {
  const ref = doc(db, 'vehicleMileages', docId(uid, year, month));
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// 동일 사용자의 가장 최근(이번달 이전) 누적 km 1건
export async function getLatestPrevMileage(uid, year, month) {
  const targetYm = ymKey(year, month);
  const q = query(
    colRef,
    where('uid', '==', uid),
    where('yearMonth', '<', targetYm),
    orderBy('yearMonth', 'desc'),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function saveMileage(uid, year, month, payload) {
  const ym = ymKey(year, month);
  const ref = doc(db, 'vehicleMileages', docId(uid, year, month));
  const odometer = Number(payload.odometer) || 0;
  const prevOdometer = Number(payload.prevOdometer) || 0;
  const drivenKm = odometer >= prevOdometer ? odometer - prevOdometer : 0;
  await setDoc(
    ref,
    {
      uid,
      userName: payload.userName || '',
      plate: payload.plate || '',
      yearMonth: ym,
      year,
      month,
      odometer,
      prevOdometer,
      drivenKm,
      recordedAt: new Date(),
    },
    { merge: true },
  );
}

// 관리자 — 특정 월 전체 운행자 기록
export async function getMileagesByMonth(year, month) {
  const ym = ymKey(year, month);
  const q = query(colRef, where('yearMonth', '==', ym));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 관리자 — 특정 사용자의 전체 운행 기록 (최신순)
export async function getMileagesByUser(uid) {
  const q = query(colRef, where('uid', '==', uid), orderBy('yearMonth', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
