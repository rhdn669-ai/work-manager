import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// 고정지출 — 월별 단일 문서로 저장
// 컬렉션: monthlyFixedExpenses
// 문서 ID: YYYY-MM (예: 2026-04)
// 데이터: { items: [{ id, category, name, amount }], updatedAt }

export const FIXED_EXPENSE_CATEGORIES = [
  '월세',
  '대출',
  '보험',
  '구독료',
  '통신비',
  '세무',
  '기타',
];

function ymKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export async function getFixedExpenses(year, month) {
  const ref = doc(db, 'monthlyFixedExpenses', ymKey(year, month));
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const items = snap.data().items;
  return Array.isArray(items) ? items : [];
}

export async function saveFixedExpenses(year, month, items) {
  const ref = doc(db, 'monthlyFixedExpenses', ymKey(year, month));
  await setDoc(ref, { items, updatedAt: new Date() }, { merge: true });
}
