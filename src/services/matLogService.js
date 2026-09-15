// 자재 이력 저장 — 줄에서 한 일이 그 줄(그리고 상대 호기 줄)에 남는다. (2026-09-15 대표님)
//
// 한 번의 조작으로 ① 내 줄 수량 ② 내 줄 기록 ③ 상대 호기 줄 수량 ④ 상대 호기 줄 기록이
// 함께 움직인다 (「둘중 하나만 체크가 되어도 둘다 기록이 남는것」).
// 재고 통은 「구매」·「수리 입고」일 때만 −n 한다 — 실물이 있어야 채울 수 있다.
import { doc, setDoc, serverTimestamp } from '../config/data';
import { db } from '../config/data';
import { getPanelMaterials, materialsDocId, setReceived, addFromStock } from './panelMaterialsService';
import { takeStock } from './stockService';
import { newLog, mateLog, mateDelta, needsStock } from '../domain/matLog';

const ref = (panelId, box) => doc(db, 'panelMaterials', materialsDocId(panelId, box));

async function appendLog(panelId, box, rowId, log) {
  const mats = await getPanelMaterials(panelId);
  const cur = mats?.[box]?.[rowId]?.log || [];
  await setDoc(
    ref(panelId, box),
    { panelId, box, items: { [rowId]: { log: [...cur, log] } }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** 그 호기 줄 수량을 delta 만큼 — 0 밑으로는 안 내려간다. 통에서 온 몫은 뺄 때만 같이 줄인다
 *  (2026-09-16 대표님 「1개 가져갔을때 -1로 안하기로 했지않나?」 — 없는 줄에서 가져가면 기록만 남는다) */
async function shift(panelId, box, rowId, delta, by = '') {
  const d = Number(delta) || 0;
  if (!d) return;
  const mats = await getPanelMaterials(panelId);
  const rec = mats?.[box]?.[rowId] || {};
  const before = Number(rec.qty) || 0;
  const after = Math.max(0, before + d);
  if (after === before) return;
  await setReceived(panelId, box, rowId, after, by);
  if (after < before) {
    const kept = Math.max(0, Number(rec.fromStock) || 0);
    if (kept > 0) await addFromStock(panelId, box, rowId, -Math.min(kept, before - after), kept);
  }
}

/**
 * 줄에서 한 일을 적는다.
 * @param panel { id, 회사 }
 * @param row   { id, itemId, … } · kind 'out'|'in'|'why' · why 사유 · n 개수 · mate 상대 호기 id
 * @param opts  { by, note, stockKind }  stockKind 는 구매·수리 입고일 때 통 갈래
 */
export async function writeMatLog(
  panel,
  box,
  row,
  { kind, why, n = 1, mate = '', by = '', note = '', stockKind = 'paid' } = {},
) {
  if (!panel?.id || !box || !row?.id || !kind || !why) throw new Error('호기·품목·사유가 필요합니다');
  const log = newLog({ kind, why, n, mate, by, note });

  // 통에서 꺼내야 하는 까닭이면 «있는 만큼만» — 없으면 아무것도 안 한다
  if (needsStock(kind, why)) {
    if (!row.itemId) throw new Error('품목이 재고와 이어져 있지 않습니다');
    const { take } = await takeStock(stockKind, panel.회사 || '', row.itemId, log.n, {
      by,
      note: `${why} · ${panel.프로젝트 || panel.id} · ${box}`,
    });
    if (take < log.n) throw new Error(`재고에 ${take}개뿐이라 ${log.n}개를 채울 수 없습니다`);
    await addFromStock(
      panel.id,
      box,
      row.id,
      take,
      Math.max(0, Number((await getPanelMaterials(panel.id))?.[box]?.[row.id]?.fromStock) || 0),
    );
  }

  // 내 줄 — 'why' 는 수량을 안 건드린다
  const myDelta = kind === 'in' ? +log.n : kind === 'out' ? -log.n : 0;
  if (myDelta) await shift(panel.id, box, row.id, myDelta, by);
  await appendLog(panel.id, box, row.id, log);

  // 상대 호기 — 짝 기록과 수량
  const pair = mateLog(log, panel.id);
  if (pair && log.mate) {
    const d = mateDelta(log);
    if (d) await shift(log.mate, box, row.id, d, by);
    await appendLog(log.mate, box, row.id, pair);
  }
  return log;
}

/** 이력 한 줄 지우기 — 수량은 되돌리지 않는다(지금 수량이 실물이다). 짝도 함께 지운다 */
export async function removeMatLog(panelId, box, rowId, logId) {
  const mats = await getPanelMaterials(panelId);
  const list = mats?.[box]?.[rowId]?.log || [];
  const log = list.find((x) => x.id === logId);
  if (!log) return null;
  await setDoc(
    ref(panelId, box),
    { panelId, box, items: { [rowId]: { log: list.filter((x) => x.id !== logId) } }, updatedAt: serverTimestamp() },
    { merge: true },
  );
  if (log.mate) {
    const mMats = await getPanelMaterials(log.mate);
    const mList = mMats?.[box]?.[rowId]?.log || [];
    const rest = mList.filter((x) => x.pair !== log.id);
    if (rest.length !== mList.length) {
      await setDoc(
        ref(log.mate, box),
        { panelId: log.mate, box, items: { [rowId]: { log: rest } }, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
  }
  return log;
}
