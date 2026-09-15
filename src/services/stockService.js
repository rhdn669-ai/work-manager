// 재고 통 — 세 갈래(사급·도급·판금)를 한 손잡이로. (2026-09-15 설계 「재고를 통 실값 하나로」)
//
// 통 하나 = 회사 × 품목 × 갈래.  id = `${회사}__${품목id}`
//   사급        freeStock  { company, itemId, qty, ours, log[] }   ours = 그중 «우리가 댄» 몫
//   도급·판금   paidStock  { company, itemId, qty, log[] }
// 굳히기 전 도급·판금의 qty 는 실값이 아니라 조정치다 — 그동안은 paidStockService 의 예전
// 함수(setPaidStockTo 등)가 그 뜻으로 쓴다. 여기 함수들은 «통이 실값»일 때의 규칙만 안다
// (domain/stockLedger.ledgerOn 이 켜졌을 때).
//
// 규칙: 통에 있는 만큼까지만 꺼낸다. 되돌리면 그만큼 돌아온다. 음수 없음.
import { collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp, arrayUnion, increment } from '../config/data';
import { takeOrder, returnOrder } from '../domain/freeStockOwner';
import { db } from '../config/data';

// 표 이름은 글자 그대로 적는다 — verify:collections 가 이 모양(collection(db, '…'))만 찾아
// 서버에 표가 있는지 대조한다. 변수로 감추면 대조에서 빠져 조용한 빈 값이 된다.
const freeRef = collection(db, 'freeStock');
const paidRef = collection(db, 'paidStock');
const LABEL = { free: '사급 재고', paid: '도급 재고', made: '판금 재고' };

const refOf = (kind) => (kind === 'free' ? freeRef : paidRef);
export const stockId = (company, itemId) => `${company}__${itemId}`;
const docOf = (kind, company, itemId) => doc(refOf(kind), stockId(company, itemId));

/** 회사 것만 골라 { itemId: { qty, ours, log, … } } 으로 */
export function subscribeStock(kind, company, cb) {
  return onSnapshot(
    refOf(kind),
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
      console.error(`[${LABEL[kind] || '재고'}] 구독 오류:`, err);
      cb({});
    },
  );
}

/** 통에 있는 전부와 «우리가 댄» 몫 — 사급만 ours 가 있다 */
export async function getStockSplit(kind, company, itemId) {
  const snap = await getDoc(docOf(kind, company, itemId));
  if (!snap.exists()) return { qty: 0, ours: 0 };
  const v = snap.data() || {};
  const qty = Math.max(0, Number(v.qty) || 0);
  return { qty, ours: kind === 'free' ? Math.min(Math.max(0, Number(v.ours) || 0), qty) : 0 };
}

export async function getStockQty(kind, company, itemId) {
  return (await getStockSplit(kind, company, itemId)).qty;
}

const itemFields = (company, item) => ({
  company,
  itemId: item.itemId,
  code: item.code || '',
  name: item.name || '',
  spec: item.spec || '',
  unit: item.unit || '',
  drawingNo: item.drawingNo || '',
});

/** 들어옴 — 이미 있는 품목이면 더해진다. ours 는 사급에서 «우리가 댄» 몫일 때만 */
export async function receiveStock(kind, company, item, n, { by = '', note = '', ours = false } = {}) {
  const add = Math.max(0, Number(n) || 0);
  if (!add || !item?.itemId) return 0;
  const mine = kind === 'free' && !!ours;
  await setDoc(
    docOf(kind, company, item.itemId),
    {
      ...itemFields(company, item),
      qty: increment(add),
      ...(mine ? { ours: increment(add) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'in', n: add, note, ours: mine }),
    },
    { merge: true },
  );
  return add;
}

/**
 * 나감 — 호기로 가져갈 때. 통에 있는 것보다 많이 가져가지 않는다.
 * 사급은 고객사 것부터 나간다 (대표님 「고객사거 먼저」) — 우리 몫에서 나간 만큼을 fromOurs 로.
 * @returns { take, fromOurs }
 */
export async function takeStock(kind, company, itemId, n, { by = '', note = '' } = {}) {
  const want = Math.max(0, Number(n) || 0);
  if (!want || !itemId) return { take: 0, fromOurs: 0 };
  const { qty, ours } = await getStockSplit(kind, company, itemId);
  const { take, fromOurs } = takeOrder({ qty, ours, want });
  if (take <= 0) return { take: 0, fromOurs: 0 };
  await setDoc(
    docOf(kind, company, itemId),
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

/** 되돌림 — 호기에서 뺀 것을 통으로. 사급은 우리 몫에서 꺼냈던 만큼(tookOurs)을 먼저 우리 몫으로 */
export async function returnStock(kind, company, itemId, n, { by = '', note = '', tookOurs = 0 } = {}) {
  const { back, toOurs } = returnOrder({ back: n, tookOurs: kind === 'free' ? tookOurs : 0 });
  if (!back || !itemId) return 0;
  await setDoc(
    docOf(kind, company, itemId),
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

/** 손으로 맞추기 — 실물을 세어 보고 그 값으로. ours 는 사급만 */
export async function setStockTo(kind, company, item, to, { by = '', reason = '', ours = null } = {}) {
  const t = Math.max(0, Number(to) || 0);
  const from = await getStockQty(kind, company, item.itemId);
  await setDoc(
    docOf(kind, company, item.itemId),
    {
      ...itemFields(company, item),
      qty: t,
      ...(kind === 'free' && ours !== null ? { ours: Math.min(Math.max(0, Number(ours) || 0), t) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({ at: new Date().toISOString(), by, kind: 'fix', from, n: t, note: reason }),
    },
    { merge: true },
  );
  return t;
}

/**
 * 발주서 입고가 통에 닿는 자리 (설계 3절 「발주서 입고 체크 → 통 +」).
 * apply 가 false 면(굳히기 전) 기록만 남기고 qty 는 건드리지 않는다 — 그동안 도급 남음은
 * 발주서를 다시 세서 얻으므로 여기서도 더하면 두 번 센다. 입고 취소(n < 0)는 0 밑으로
 * 내려가지 않고 그 사실을 기록에 남긴다.
 */
export async function noteOrderIntake(kind, company, item, n, { by = '', note = '', apply = false } = {}) {
  const d = Number(n) || 0;
  if (!d || !item?.itemId) return 0;
  let delta = d;
  if (apply && d < 0) {
    const have = await getStockQty(kind, company, item.itemId);
    delta = -Math.min(have, -d);
  }
  await setDoc(
    docOf(kind, company, item.itemId),
    {
      ...itemFields(company, item),
      ...(apply && delta !== 0 ? { qty: increment(delta) } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: by,
      log: arrayUnion({
        at: new Date().toISOString(),
        by,
        kind: d > 0 ? 'po-in' : 'po-cancel',
        n: Math.abs(d),
        note,
        applied: !!apply,
        ...(apply && delta !== d ? { clipped: Math.abs(d) - Math.abs(delta) } : {}),
      }),
    },
    { merge: true },
  );
  return apply ? delta : 0;
}
