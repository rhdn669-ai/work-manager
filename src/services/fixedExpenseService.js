import { collection, doc, getDoc, getDocs, setDoc } from '../config/data';
import { db } from '../config/data';

// 고정지출 — 월별 단일 문서로 저장
// 컬렉션: monthlyFixedExpenses
// 문서 ID: YYYY-MM (예: 2026-04)
// 데이터: { items: [{ id, category, name, amount }], updatedAt }
//
// 자동 이월: 해당 월 문서가 존재하지 않으면 가장 가까운 과거 월의 항목을 반환.
//   - 사용자가 신규 월에서 수정/추가 시 그 월부터 독립 문서 생성
//   - 의도적으로 비운(items=[]) 월은 빈 상태 유지

const collectionRef = collection(db, 'monthlyFixedExpenses');

export const FIXED_EXPENSE_CATEGORIES = ['월세', '대출', '보험', '구독료', '통신비', '세무', '기타'];

function ymKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export async function getFixedExpenses(year, month) {
  const target = ymKey(year, month);
  const ref = doc(db, 'monthlyFixedExpenses', target);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const items = snap.data().items;
    return Array.isArray(items) ? items : [];
  }
  // fallback: 가장 가까운 과거 월의 항목을 자동 이월
  const allSnap = await getDocs(collectionRef);
  let bestKey = '';
  let bestItems = [];
  allSnap.forEach((d) => {
    if (d.id < target && d.id > bestKey) {
      const data = d.data();
      if (Array.isArray(data.items) && data.items.length > 0) {
        bestKey = d.id;
        bestItems = data.items;
      }
    }
  });
  return bestItems;
}

export async function saveFixedExpenses(year, month, items) {
  const ref = doc(db, 'monthlyFixedExpenses', ymKey(year, month));
  await setDoc(ref, { items, updatedAt: new Date() }, { merge: true });
}
