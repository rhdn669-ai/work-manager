// 사급 재고 — 고객사가 준 물건을 호기 정하기 전에 모아 두는 곳. (2026-09-10 대표님)
//
// 창고 재고(purchaseItems.stockQty)와 «따로» 둔다. 창고 재고는 우리가 돈 주고 산 물건이고,
// 사급은 고객사 물건이다. 회사(메티스·디에이치)가 다르면 다른 물건이므로 회사별로 센다.
//
// 문서 하나 = 회사 하나의 품목 하나.  id = `${회사}__${품목id}`
//   { company, itemId, code, name, spec, qty, updatedAt, updatedBy }
// 들어오고 나간 자취는 log 에 쌓는다 — 언제 얼마가 들어와 어느 호기로 갔는지 본다.
import { collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp, arrayUnion, increment } from '../config/data';
import { takeOrder, returnOrder } from '../domain/freeStockOwner';
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

/** 통에 있는 전부와 «우리가 댄» 몫 — 고객사 것은 qty − ours (2026-09-12 대표님) */
export async function getFreeStockSplit(company, itemId) {
  const snap = await getDoc(doc(ref, freeStockId(company, itemId)));
  if (!snap.exists()) return { qty: 0, ours: 0 };
  const v = snap.data() || {};
  const qty = Math.max(0, Number(v.qty) || 0);
  return { qty, ours: Math.min(Math.max(0, Number(v.ours) || 0), qty) };
}

// 들어옴 — 이미 있는 품목이면 수량이 더해진다
export async function receiveFreeStock(company, item, n, { by = '', note = '', ours = false } = {}) {
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
      // 우리가 댄 몫은 따로 세어 둔다 — 나중에 「이건 우리가 댄 것」을 가릴 수 있게
      ...(ours ? { ours: increment(add) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'in', n: add, note, ours: !!ours }),
    },
    { merge: true },
  );
  return add;
}

// 나감 — 호기로 가져갈 때. 재고보다 많이 가져가지 않는다.
// 고객사 것부터 나간다 (2026-09-12 대표님 「고객사거 먼저」) — 받은 것을 먼저 쓰고 우리 것은
// 아껴 둔다. 되돌릴 때 우리 몫으로 얼마를 돌릴지 알 수 있게 fromOurs 를 함께 돌려준다.
export async function takeFreeStock(company, itemId, n, { by = '', note = '' } = {}) {
  const want = Math.max(0, Number(n) || 0);
  if (!want || !itemId) return { take: 0, fromOurs: 0 };
  const { qty, ours } = await getFreeStockSplit(company, itemId);
  const { take, fromOurs } = takeOrder({ qty, ours, want });
  if (take <= 0) return { take: 0, fromOurs: 0 };
  await setDoc(
    doc(ref, freeStockId(company, itemId)),
    {
      qty: increment(-take),
      ...(fromOurs > 0 ? { ours: increment(-fromOurs) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'out', n: take, note, fromOurs }),
    },
    { merge: true },
  );
  return { take, fromOurs };
}

// 호기에서 되돌릴 때 — 가져갔던 만큼 재고로 돌려준다
export async function returnFreeStock(company, itemId, n, { by = '', note = '', tookOurs = 0 } = {}) {
  const { back, toOurs } = returnOrder({ back: n, tookOurs });
  if (!back || !itemId) return 0;
  await setDoc(
    doc(ref, freeStockId(company, itemId)),
    {
      qty: increment(back),
      ...(toOurs > 0 ? { ours: increment(toOurs) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'back', n: back, note, toOurs }),
    },
    { merge: true },
  );
  return back;
}

// 손으로 맞추기 — 실물을 세어 보고 숫자를 고칠 때
export async function setFreeStockQty(company, item, to, { by = '', reason = '', ours = null } = {}) {
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
      ...(ours === null ? {} : { ours: Math.min(Math.max(0, Number(ours) || 0), t) }),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'fix', from, n: t, note: reason }),
    },
    { merge: true },
  );
  return t;
}
