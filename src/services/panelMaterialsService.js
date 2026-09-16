import { collection, doc, getDocs, onSnapshot, query, where, setDoc, serverTimestamp } from '../config/data';
import { db } from '../config/data';

// 호기 × BOX 의 구성품 입고 기록 (2026-09-03 대표님 「호기별로 자재 사급 도급 리스트」).
//
// 문서 하나 = 호기 하나의 BOX 하나. id 는 `${panelId}__${box}`.
//   { panelId, box, items: { [bomItemId]: { qty, at: 'YYYY-MM-DD', by } }, updatedAt }
// 같은 BOM 을 여러 호기가 쓰므로 BOM 이 아니라 «호기» 아래에 둔다. BOM 구성품이 나중에
// 늘어도 여기엔 안 적힌 줄이 「아직 0개」로 보일 뿐이라 목록이 저절로 따라온다.
const ref = collection(db, 'panelMaterials');

export function materialsDocId(panelId, box) {
  // BOX 이름에 「/」가 있다(P/W BOX). Firestore 문서 id 에 「/」는 못 쓴다.
  return `${panelId}__${String(box || '').replace(/\//g, '∕')}`;
}

/** 호기 하나의 모든 BOX 기록을 실시간으로 — cb({ [box]: items }) */
export function subscribePanelMaterials(panelId, cb) {
  if (!panelId) return () => {};
  return onSnapshot(ref, (snap) => {
    const out = {};
    snap.docs.forEach((d) => {
      const v = d.data();
      if (v.panelId === panelId) out[v.box] = v.items || {};
    });
    cb(out);
  });
}

/** 구성품 하나의 들어온 개수를 적는다 — 문서를 통째로 다시 쓰지 않고 그 줄만 */
/**
 * 이 호기·이 줄에 들어온 개수. 0 밑으로는 안 내려간다.
 * (옛 allowNegative 인자는 뺐다 — 「없는 줄에서 가져가면 기록만 남고 −1 은 안 만든다」로
 *  정해지면서 부르는 곳이 하나도 없었다. 2026-09-16 야간 조사 S22)
 */
export async function setReceived(panelId, box, bomItemId, qty, by) {
  const n = Math.max(0, Number(qty) || 0);
  const today = new Date().toISOString().slice(0, 10);
  await setDoc(
    doc(ref, materialsDocId(panelId, box)),
    {
      panelId,
      box,
      items: { [bomItemId]: { qty: n, at: today, by: by || '' } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** 이 호기에서만 그 줄을 일시 제외/복귀 — 개수는 그대로 두고 skip 표시만 */
export async function setSkipped(panelId, box, bomItemId, skip, by) {
  const today = new Date().toISOString().slice(0, 10);
  await setDoc(
    doc(ref, materialsDocId(panelId, box)),
    {
      panelId,
      box,
      items: { [bomItemId]: { skip: !!skip, skipAt: today, skipBy: by || '' } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** 호기 하나의 기록을 한 번만 — { [box]: items } (부족분 채우기 전에 현재 값을 볼 때) */
export async function getPanelMaterials(panelId) {
  const snap = await getDocs(query(ref, where('panelId', '==', panelId)));
  const out = {};
  snap.docs.forEach((d) => {
    const v = d.data();
    out[v.box] = v.items || {};
  });
  return out;
}

/** 한 BOX 의 여러 줄을 한 번에 — entries [{ id, qty }] (도급 세트 배정용) */
export async function setReceivedMany(panelId, box, entries, by) {
  const today = new Date().toISOString().slice(0, 10);
  const items = {};
  for (const e of entries || []) {
    if (!e?.id) continue;
    items[e.id] = { qty: Math.max(0, Number(e.qty) || 0), at: today, by: by || '' };
  }
  await setDoc(
    doc(ref, materialsDocId(panelId, box)),
    { panelId, box, items, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** 모든 호기의 기록을 한 번에 — cb({ [panelId]: { [box]: items } }). 구간 부족 집계용 */
export function subscribeAllMaterials(cb) {
  return onSnapshot(ref, (snap) => {
    const out = {};
    snap.docs.forEach((d) => {
      const v = d.data();
      if (!v.panelId) return;
      if (!out[v.panelId]) out[v.panelId] = {};
      out[v.panelId][v.box] = v.items || {};
    });
    cb(out);
  });
}

/** 창고 재고에서 가져온 개수를 그 줄에 누적해 적는다 — 기록에 「재고 N」으로 보인다 (2026-09-05 대표님) */
/** 사급을 「없는데 바로 체크」해서 통에 없던 만큼 받은 걸로 적은 양 — 되돌릴 때 그만큼은
 *  통으로 돌려주지 않고 «없던 일»로 만든다. 안 그러면 없던 재고가 생긴다
 *  (2026-09-12 대표님 「없는 수량을 넣었다가 다시빼면 없던 재고가 생겨버림」). */

/** 그 줄이 사급 재고의 «우리 몫»에서 꺼내 쓴 누계 — 되돌릴 때 우리 몫으로 얼마를 돌릴지 안다
 *  (2026-09-12 대표님 「고객사거 먼저」). 음수로 부르면 줄어든다. */
// 누계는 «지금 저장된 값»에 더한다 — 화면이 기억한 값(prev)은 되돌리기처럼 연달아 저장할 때 한 박자
// 늦어, 207 호기 줄이 통에서 1개만 가져왔는데 누계가 3으로 적혔다. 줄일 때 그 3이 통으로 돌아갔다
// (2026-09-16 대표님 「재고가 없는 호기에서 끌어온 입고수량을 취소하니까 재고가 다시 생겨버리네」).
async function storedTally(panelId, box, bomItemId, field) {
  const mats = await getPanelMaterials(panelId);
  return Math.max(0, Number(mats?.[box]?.[bomItemId]?.[field]) || 0);
}

// eslint-disable-next-line no-unused-vars
export async function addFromOurs(panelId, box, bomItemId, n, prev = 0) {
  const delta = Number(n) || 0;
  if (!delta) return;
  const cur = await storedTally(panelId, box, bomItemId, 'fromOurs');
  const next = Math.max(0, cur + delta);
  if (next === cur) return;
  await setDoc(
    doc(ref, materialsDocId(panelId, box)),
    {
      panelId,
      box,
      items: { [bomItemId]: { fromOurs: next } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// 되돌릴 때는 음수로 부른다 — 재고로 돌려준 만큼 이 줄의 「재고에서 쓴 누계」도 줄어야 한다
// (2026-09-12: 안 줄이면 다음에 지울 때 또 돌려주게 된다).
// eslint-disable-next-line no-unused-vars
export async function addFromStock(panelId, box, bomItemId, n, prev = 0) {
  const delta = Number(n) || 0;
  if (!delta) return;
  const cur = await storedTally(panelId, box, bomItemId, 'fromStock');
  const next = Math.max(0, cur + delta);
  if (next === cur) return;
  await setDoc(
    doc(ref, materialsDocId(panelId, box)),
    {
      panelId,
      box,
      items: { [bomItemId]: { fromStock: next } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** 이 호기·이 줄의 비고 — 개수와 별개로 한 줄 메모 (2026-09-05 대표님 「비고란도 하나」) */
export async function setNote(panelId, box, bomItemId, note) {
  await setDoc(
    doc(ref, materialsDocId(panelId, box)),
    {
      panelId,
      box,
      items: { [bomItemId]: { note: String(note || '').trim() } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
