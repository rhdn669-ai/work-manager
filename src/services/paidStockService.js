// 도급 재고 통 — 우리가 사서 넣는 자재 중 아직 어느 호기에도 안 간 것.
//
// 지금까지 도급 재고는 «발주서 입고 − 호기 투입» 으로 계산만 됐다. 그래서 실물이 남아
// 있어도 앱에는 0 으로 나오고, 손으로 넣을 데가 없었다
// (2026-09-12 대표님 「도급품도 남는게 있어서 재고에도 수량 직접 넣고싶은데」).
//
// 여기에 적는 것은 «발주서로 설명되지 않는 몫»이다. 옛 재고를 옮겨 적은 것, 세어 보니
// 더 있던 것, 반대로 모자라던 것. 그래서 음수도 받는다 — 실물이 셈보다 적을 때 맞춰야 한다.
//   남음 = (발주서 입고 + 여기 적은 몫) − 호기 투입
//
// 사급 재고(freeStockService)와 같은 모양으로 둔다 — 두 통이 같은 생김새라야 헷갈리지 않는다.
// 회사(메티스·디에이치)마다 통이 따로다 (대표님 「메티스 디에이치 따로 별개의 프로젝트 재고통 따로」).
//   문서 하나 = 회사 하나의 품목 하나.  id = `${회사}__${품목id}`
import { collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp, arrayUnion, increment } from '../config/data';
import { db } from '../config/data';

const ref = collection(db, 'paidStock');

export const paidStockId = (company, itemId) => `${company}__${itemId}`;

/** 회사 것만 골라 { itemId: { qty, log, … } } 으로 */
export function subscribePaidStock(company, cb) {
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
      console.error('[도급 재고] 구독 오류:', err);
      cb({});
    },
  );
}

export async function getPaidStockQty(company, itemId) {
  const snap = await getDoc(doc(ref, paidStockId(company, itemId)));
  return snap.exists() ? Number(snap.data().qty) || 0 : 0;
}

/** 들어옴 — 적은 수만큼 통에 더한다 */
export async function receivePaidStock(company, item, n, { by = '', note = '' } = {}) {
  const add = Math.max(0, Number(n) || 0);
  if (!add || !item?.itemId) return 0;
  await setDoc(
    doc(ref, paidStockId(company, item.itemId)),
    {
      company,
      itemId: item.itemId,
      code: item.code || '',
      name: item.name || '',
      spec: item.spec || '',
      drawingNo: item.drawingNo || '',
      qty: increment(add),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'in', n: add, note }),
    },
    { merge: true },
  );
  return add;
}

/**
 * 손으로 맞춤 — 화면에 보이는 «남음»을 실제로 센 개수로 맞춘다.
 * 여기 적는 값은 남음이 아니라 «발주서로 설명되지 않는 몫»이므로, 목표에서 계산분을 뺀다.
 *   base = 발주서 입고 − 호기 투입  (지금 이 줄의 계산된 남음)
 */
export async function setPaidStockTo(company, item, want, { base = 0, by = '' } = {}) {
  if (!item?.itemId) return 0;
  const adjust = (Number(want) || 0) - (Number(base) || 0);
  await setDoc(
    doc(ref, paidStockId(company, item.itemId)),
    {
      company,
      itemId: item.itemId,
      code: item.code || '',
      name: item.name || '',
      spec: item.spec || '',
      drawingNo: item.drawingNo || '',
      qty: adjust,
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'fix', to: Number(want) || 0, n: adjust }),
    },
    { merge: true },
  );
  return adjust;
}

/** 나감 — 호기로 가져갈 때. 통에 있는 것보다 많이 가져가지 않는다. */
export async function takePaidStock(company, item, n, { by = '', note = '' } = {}) {
  const want = Math.max(0, Number(n) || 0);
  if (!want || !item?.itemId) return 0;
  const have = await getPaidStockQty(company, item.itemId);
  const take = Math.min(want, Math.max(0, have));
  if (take <= 0) return 0;
  await setDoc(
    doc(ref, paidStockId(company, item.itemId)),
    {
      company,
      itemId: item.itemId,
      qty: increment(-take),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'out', n: take, note }),
    },
    { merge: true },
  );
  return take;
}

/** 되돌림 — 호기에서 뺀 것을 통으로 돌려준다 (배정 취소) */
export async function givebackPaidStock(company, item, n, { by = '', note = '' } = {}) {
  const back = Math.max(0, Number(n) || 0);
  if (!back || !item?.itemId) return 0;
  await setDoc(
    doc(ref, paidStockId(company, item.itemId)),
    {
      company,
      itemId: item.itemId,
      qty: increment(back),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'back', n: back, note }),
    },
    { merge: true },
  );
  return back;
}
