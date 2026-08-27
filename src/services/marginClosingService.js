// 마감 리스트 저장소.
//
// 한 달치가 문서 하나다 — 확정 기록과 월 잠금이 함께 들어간다.
// 보는 사람이 관리자·대표·부사장 셋뿐이라 한 문서로 충분하고, 월별로 나뉘어 있어
// 오래된 달이 새 달을 무겁게 하지 않는다.
//
// 손으로 넣은 항목만 따로 컬렉션을 쓴다. 삭제가 휴지통을 거쳐야 하는데(앱 규칙),
// 휴지통은 문서 단위로 옮기기 때문이다.
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { trashGeneric } from './trashService';

const closingsRef = collection(db, 'marginClosings');
const manualRef = collection(db, 'marginClosingItems');

export function monthDocId(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// 그달의 확정 기록·잠금 상태. 아직 손댄 적 없는 달이면 빈 상태로 돌려준다.
export async function getMonthClosing(year, month) {
  const snap = await getDoc(doc(closingsRef, monthDocId(year, month)));
  const data = snap.exists() ? snap.data() : {};
  return {
    confirms: data.confirms || {},
    locked: !!data.locked,
    lockedBy: data.lockedBy || '',
    lockedAt: data.lockedAt || null,
  };
}

// 확정된 키를 모아 온다 — 결제 페이지가 「이 건 마감 확정됐나」를 물을 때 쓴다.
//
// 확정은 월별 문서에 나뉘어 있는데, 두 화면이 보는 달이 서로 다르다.
//   마감 확정 → 입고한 달에 저장   결제 페이지 → 결제 마감일 기준으로 봄
// 8월 입고분의 결제 마감이 9월이면 두 달이 어긋난다. 게다가 결제에서 「전체」를 고르면
// 기준 달 자체가 없다. 그래서 최근 열두 달을 통째로 읽어 합친다
// (2026-08-27 대표님 「마감 리스트에 확정 했는데 결제에 미확정으로 남아있는건 뭐임」).
//
// 문서 열두 개 읽기가 무거워 보이지만 한 달치가 작고 한 번만 읽는다.
//
// 반환: 확정된 키만 담은 Set
export async function getConfirmedKeys(baseDate = new Date(), months = 12) {
  const base = baseDate instanceof Date ? baseDate : new Date(baseDate);
  const from = Number.isNaN(base.getTime()) ? new Date() : base;
  const ids = [];
  // 앞뒤로 본다 — 결제 마감일이 입고 달보다 뒤일 수도, 늦게 확정해 앞일 수도 있다
  for (let i = -2; i < months; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    ids.push(monthDocId(d.getFullYear(), d.getMonth() + 1));
  }
  const snaps = await Promise.all(ids.map((mid) => getDoc(doc(closingsRef, mid))));
  const out = new Set();
  for (const snap of snaps) {
    if (!snap.exists()) continue;
    for (const [k, v] of Object.entries(snap.data().confirms || {})) {
      if (v?.confirmed) out.add(k);
    }
  }
  return out;
}

// 한 건의 금액·확정 여부를 적는다. 금액을 안 고쳤으면 amount 는 넘기지 않는다 —
// 그래야 나중에 입고가 더 잡혔을 때 자동 계산값이 그대로 따라온다.
export async function setRowConfirm(year, month, key, { amount, confirmed, by }) {
  const ref = doc(closingsRef, monthDocId(year, month));
  const entry = { confirmed: !!confirmed, by: by || '', at: new Date() };
  if (amount != null) entry.amount = Number(amount) || 0;
  await setDoc(ref, { monthKey: monthDocId(year, month), confirms: { [key]: entry } }, { merge: true });
}

// 고친 금액을 되돌린다 — 자동 계산값으로 돌아간다.
export async function clearRowAmount(year, month, key) {
  const ref = doc(closingsRef, monthDocId(year, month));
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const confirms = { ...(snap.data().confirms || {}) };
  if (!confirms[key]) return;
  const { amount, ...rest } = confirms[key]; // eslint-disable-line no-unused-vars
  confirms[key] = rest;
  await updateDoc(ref, { confirms });
}

// 월 마감 — 미확정이 남아 있어도 잠근다. 끝내 금액을 모를 건이 있기 때문이다
// (2026-08-25 대표님). 대신 화면에서 몇 건이 빠지는지 알리고 확인을 받는다.
export async function lockMonth(year, month, by = '') {
  await setDoc(
    doc(closingsRef, monthDocId(year, month)),
    { monthKey: monthDocId(year, month), locked: true, lockedBy: by, lockedAt: new Date() },
    { merge: true },
  );
}

export async function unlockMonth(year, month) {
  await setDoc(
    doc(closingsRef, monthDocId(year, month)),
    { locked: false, lockedBy: '', lockedAt: null },
    { merge: true },
  );
}

// ---------- 손으로 넣은 항목 ----------

export async function getManualItems(year, month) {
  const q = query(manualRef, where('monthKey', '==', monthDocId(year, month)));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addManualItem(year, month, data) {
  return addDoc(manualRef, {
    monthKey: monthDocId(year, month),
    kind: data.kind === 'revenue' ? 'revenue' : 'expense',
    vendor: data.vendor || '',
    siteName: data.siteName || '',
    description: data.description || '',
    amount: Number(data.amount) || 0,
    payDue: data.payDue || '', // 결제일 (YYYY-MM-DD) — 자동 건과 같은 형식
    createdAt: new Date(),
    createdBy: data.createdBy || '',
  });
}

export async function updateManualItem(id, data) {
  return updateDoc(doc(manualRef, id), { ...data, updatedAt: new Date() });
}

// 삭제는 휴지통을 거친다 — 영구 삭제 금지 (앱 규칙).
export async function trashManualItem(id, deletedByName = '') {
  const snap = await getDoc(doc(manualRef, id));
  const d = snap.exists() ? snap.data() : {};
  const title = d.vendor || d.siteName || d.description || '(이름 없음)';
  const won = (Number(d.amount) || 0).toLocaleString();
  return trashGeneric(
    'marginClosingItems',
    id,
    { title, summary: `${d.kind === 'revenue' ? '매출' : '지출'} · ${won}원 · ${d.monthKey || ''}` },
    deletedByName,
  );
}
