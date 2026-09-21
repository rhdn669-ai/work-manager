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
/** 모든 호기의 체크 기록을 «한 번만» 읽는다 — { [panelId]: { [box]: items } }.
 *  BOM 줄을 지우기 전에 딸린 몫을 세는 것처럼, 상시 구독할 것 없이 그때만 볼 때 쓴다. */
export async function getAllMaterials() {
  const snap = await getDocs(ref);
  const out = {};
  snap.docs.forEach((d) => {
    const v = d.data();
    if (!v.panelId) return;
    if (!out[v.panelId]) out[v.panelId] = {};
    out[v.panelId][v.box] = v.items || {};
  });
  return out;
}

/** BOM 줄의 BOX 가 바뀌었을 때 — 모든 호기에서 그 줄의 체크 기록을 옛 BOX 문서에서 새 BOX 문서로
 *  통째로 옮긴다(수량·통에서 가져온 몫·당사 몫·이력·비고·제외·날짜·적은 사람).
 *
 *  기록은 「호기 × BOX」 문서에 살기 때문에, 줄의 BOX 만 바꾸면 기록이 옛 문서에 주인 없이 남고
 *  새 BOX 에서는 0 으로 보여 다시 채우게 된다 — 그러면 통에서 한 번 더 빠진다
 *  (2026-09-18 대표님 「기존에 체크 해둔것들은 … 그 수량을 가지고 넘어가야 하는거 아님?」).
 *  새 자리에 먼저 쓰고 그다음 옛 자리를 비운다 — 중간에 끊겨도 옛 자리가 남아 되돌릴 수 있다.
 *  @returns 옮긴 호기 수 */
export async function moveMaterialsBox(bomItemId, fromBox, toBox) {
  if (!bomItemId || !fromBox || !toBox || fromBox === toBox) return 0;
  const all = await getAllMaterials();
  let moved = 0;
  for (const [panelId, boxes] of Object.entries(all)) {
    const entry = boxes?.[fromBox]?.[bomItemId];
    if (!entry) continue;
    await setDoc(
      doc(db, 'panelMaterials', materialsDocId(panelId, toBox)),
      { panelId, box: toBox, items: { [bomItemId]: entry }, updatedAt: new Date() },
      { merge: true },
    );
    const rest = { ...boxes[fromBox] };
    delete rest[bomItemId];
    await setDoc(doc(db, 'panelMaterials', materialsDocId(panelId, fromBox)), {
      panelId,
      box: fromBox,
      items: rest,
      updatedAt: new Date(),
    });
    moved += 1;
  }
  return moved;
}

/**
 * 줄을 나눌 때 — 호기에 «체크해 둔 수량»도 함께 옮긴다.
 *
 * 필요 수량만 나누고 체크를 두면, 옮긴 쪽은 「미입고」로 뜨고 남은 쪽은 「초과」가 된다.
 * 실물은 이미 들어와 있는데 장부만 갈라지는 것이다 (2026-09-21 대표님 「기존에 수량이 입고로
 * 처리된게 나눠지면 그대로 수량을 가지고 넘어가야지」).
 *
 * 규칙: 남는 줄의 «새 필요 수량»을 먼저 채우고, 넘치는 몫만 옮긴다 — 옮긴 필요 수량까지만.
 *   예) 체크 3 · 남는 필요 2 · 옮긴 필요 1 → 2 는 남고 1 이 간다
 *       체크 2 · 남는 필요 2 · 옮긴 필요 1 → 그대로 2 (실물이 그쪽에 다 있으니 옮길 것이 없다)
 * 통에서 가져온 몫(fromStock)·당사 몫(fromOurs)도 옮기는 개수만큼 따라간다 — 재고 셈이 어긋나지 않게.
 *
 * @returns 체크를 옮긴 호기 수
 */
export async function splitMaterialsRow(fromRowId, fromBox, toRowId, toBox, keepNeed, moveNeed) {
  if (!fromRowId || !toRowId || !fromBox || !toBox) return 0;
  const keep = Math.max(0, Number(keepNeed) || 0);
  const move = Math.max(0, Number(moveNeed) || 0);
  if (move <= 0) return 0;
  const all = await getAllMaterials();
  let moved = 0;
  for (const [panelId, boxes] of Object.entries(all)) {
    const cur = boxes?.[fromBox]?.[fromRowId];
    if (!cur) continue;
    const qty = Math.max(0, Number(cur.qty) || 0);
    const n = Math.min(Math.max(0, qty - keep), move);
    if (n <= 0) continue;
    const curStock = Math.max(0, Number(cur.fromStock) || 0);
    const curOurs = Math.max(0, Number(cur.fromOurs) || 0);
    const fs = Math.min(curStock, n);
    const fo = Math.min(curOurs, fs);
    const dst = boxes?.[toBox]?.[toRowId] || {};
    // 받는 쪽에 먼저 적고 그다음 주는 쪽을 줄인다 — 중간에 끊겨도 «없어지는» 일은 없다
    await setDoc(
      doc(db, 'panelMaterials', materialsDocId(panelId, toBox)),
      {
        panelId,
        box: toBox,
        items: {
          [toRowId]: {
            qty: (Number(dst.qty) || 0) + n,
            fromStock: (Number(dst.fromStock) || 0) + fs,
            fromOurs: (Number(dst.fromOurs) || 0) + fo,
            at: dst.at || cur.at || '',
            by: dst.by || cur.by || '',
          },
        },
        updatedAt: new Date(),
      },
      { merge: true },
    );
    await setDoc(
      doc(db, 'panelMaterials', materialsDocId(panelId, fromBox)),
      {
        panelId,
        box: fromBox,
        items: { [fromRowId]: { qty: qty - n, fromStock: curStock - fs, fromOurs: curOurs - fo } },
        updatedAt: new Date(),
      },
      { merge: true },
    );
    moved += 1;
  }
  return moved;
}

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
