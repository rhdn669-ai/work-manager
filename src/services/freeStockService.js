// 사급 재고 — 고객사가 준 물건을 호기 정하기 전에 모아 두는 곳. (2026-09-10 대표님)
//
// 창고 재고(purchaseItems.stockQty)와 «따로» 둔다. 창고 재고는 우리가 돈 주고 산 물건이고,
// 사급은 고객사 물건이다. 회사(메티스·디에이치)가 다르면 다른 물건이므로 회사별로 센다.
//
// 문서 하나 = 회사 하나의 품목 하나.  id = `${회사}__${품목id}`
//   { company, itemId, code, name, spec, qty, updatedAt, updatedBy }
// 들어오고 나간 자취는 log 에 쌓는다 — 언제 얼마가 들어와 어느 호기로 갔는지 본다.
import { collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp, arrayUnion, increment } from '../config/data';
import { db } from '../config/data';

const ref = collection(db, 'freeStock');

export const freeStockId = (company, itemId) => `${company}__${itemId}`;

// 회사 것만 골라 { itemId: 수량 } 으로 — 화면이 바로 쓰기 좋게
export function subscribeFreeStock(company, cb) {
  return onSnapshot(
    ref,
    (snap) => {
      const out = {};
      snap.docs.forEach((d) => {
        const v = d.data() || {};
        if (company && v.company !== company) return;
        out[v.itemId] = { ...v, id: d.id, qty: Number(v.qty) || 0 };
      });
      cb(out);
    },
    (err) => {
      console.error('[사급 재고] 구독 오류:', err);
      cb({});
    },
  );
}

export async function getFreeStockQty(company, itemId) {
  const snap = await getDoc(doc(ref, freeStockId(company, itemId)));
  return snap.exists() ? Math.max(0, Number(snap.data().qty) || 0) : 0;
}

// 들어옴 — 이미 있는 품목이면 수량이 더해진다
export async function receiveFreeStock(company, item, n, { by = '', note = '' } = {}) {
  const add = Math.max(0, Number(n) || 0);
  if (!add || !item?.itemId) return 0;
  await setDoc(
    doc(ref, freeStockId(company, item.itemId)),
    {
      company,
      itemId: item.itemId,
      code: item.code || '',
      name: item.name || '',
      spec: item.spec || '',
      unit: item.unit || '',
      qty: increment(add),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'in', n: add, note }),
    },
    { merge: true },
  );
  return add;
}

// 나감 — 호기로 가져갈 때. 재고보다 많이 가져가지 않는다.
export async function takeFreeStock(company, itemId, n, { by = '', note = '' } = {}) {
  const want = Math.max(0, Number(n) || 0);
  if (!want || !itemId) return 0;
  const have = await getFreeStockQty(company, itemId);
  const take = Math.min(want, have);
  if (take <= 0) return 0;
  await setDoc(
    doc(ref, freeStockId(company, itemId)),
    {
      qty: increment(-take),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'out', n: take, note }),
    },
    { merge: true },
  );
  return take;
}

// 호기에서 되돌릴 때 — 가져갔던 만큼 재고로 돌려준다
export async function returnFreeStock(company, itemId, n, { by = '', note = '' } = {}) {
  const back = Math.max(0, Number(n) || 0);
  if (!back || !itemId) return 0;
  await setDoc(
    doc(ref, freeStockId(company, itemId)),
    {
      qty: increment(back),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'back', n: back, note }),
    },
    { merge: true },
  );
  return back;
}

// 손으로 맞추기 — 실물을 세어 보고 숫자를 고칠 때
export async function setFreeStockQty(company, item, to, { by = '', reason = '' } = {}) {
  const t = Math.max(0, Number(to) || 0);
  const from = await getFreeStockQty(company, item.itemId);
  await setDoc(
    doc(ref, freeStockId(company, item.itemId)),
    {
      company,
      itemId: item.itemId,
      code: item.code || '',
      name: item.name || '',
      spec: item.spec || '',
      unit: item.unit || '',
      qty: t,
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'fix', from, n: t, note: reason }),
    },
    { merge: true },
  );
  return t;
}
