import { collection, doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

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
