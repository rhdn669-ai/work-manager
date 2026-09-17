// 자재 이력 저장 — 줄에서 한 일이 그 줄(그리고 상대 호기 줄)에 남는다. (2026-09-15 대표님)
//
// 한 번의 조작으로 ① 내 줄 수량 ② 내 줄 기록 ③ 상대 호기 줄 수량 ④ 상대 호기 줄 기록이
// 함께 움직인다 (「둘중 하나만 체크가 되어도 둘다 기록이 남는것」).
// 재고 통은 「구매」·「수리 입고」일 때만 −n 한다 — 실물이 있어야 채울 수 있다.
import { doc, setDoc, serverTimestamp } from '../config/data';
import { db } from '../config/data';
import { getPanelMaterials, materialsDocId, setReceived, addFromStock, addFromOurs } from './panelMaterialsService';
import { takeStock, returnStock } from './stockService';
import { trashMatLog } from './trashService';
import { newLog, mateLog, mateDelta, needsStock, whyOf } from '../domain/matLog';
import { undoPlan } from '../domain/matUndo';

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
  if (!d) return { moved: 0, released: 0 };
  const mats = await getPanelMaterials(panelId);
  const rec = mats?.[box]?.[rowId] || {};
  const before = Number(rec.qty) || 0;
  const after = Math.max(0, before + d);
  if (after === before) return { moved: 0, released: 0 };
  await setReceived(panelId, box, rowId, after, by);
  let released = 0;
  if (after < before) {
    const kept = Math.max(0, Number(rec.fromStock) || 0);
    released = Math.min(kept, before - after);
    if (released > 0) await addFromStock(panelId, box, rowId, -released, kept);
  }
  // moved 실제로 움직인 양 · released 그중 «통에서 온 몫»으로 놓아 준 양
  return { moved: after - before, released };
}

/**
 * 줄에서 한 일을 적는다.
 * @param panel { id, 회사 }
 * @param row   { id, itemId, … } · kind 'out'|'in'|'why' · why 사유 · n 개수 · mate 상대 호기 id
 * @param opts  { by, note, stockKind, useStock }
 *   stockKind  구매·수리 입고일 때 통 갈래
 *   useStock   통(재고)을 건드릴지 — 굳히기 전(ledger off) 도급·판금은 «남음 = 발주입고 − 나감»
 *              이라 통까지 깎으면 두 번 깎인다. 호기 체크 화면은 예전부터 막고 있었는데
 *              이 창만 빠져 있었다 (2026-09-16 야간 조사 S3)
 */
export async function writeMatLog(
  panel,
  box,
  row,
  { kind, why, n = 1, mate = '', by = '', note = '', stockKind = 'paid', useStock = true } = {},
) {
  if (!panel?.id || !box || !row?.id || !kind || !why) throw new Error('호기·품목·사유가 필요합니다');
  const log = newLog({ kind, why, n, mate, by, note });

  // 같은 일을 양쪽에서 적으면 두 번 남는다 — 상대 호기에서 이미 적어 짝이 내 줄에 와 있으면 막는다
  // (2026-09-16 대표님 「209호기에서 468호기 차용했다고 걸었는데 468호기에서 209호기에 줬다고
  //  두번 해버리니까 이런 오류가 생기는데?」). 한쪽만 적으면 앱이 상대 쪽 짝을 만든다.
  if (log.mate) {
    const mine = (await getPanelMaterials(panel.id))?.[box]?.[row.id]?.log || [];
    const dup = mine.find((l) => l.pair && l.mate === log.mate && l.at === log.at && whyOf(l) === whyOf({ kind, why }));
    if (dup) throw new Error('상대 호기에서 이미 적혀 있습니다 — 한쪽에서만 적으면 됩니다');
  }

  // 통에서 꺼내야 하는 까닭이면 «있는 만큼만» — 없으면 아무것도 안 한다
  if (useStock && needsStock(kind, why)) {
    if (!row.itemId) throw new Error('품목이 재고와 이어져 있지 않습니다');
    const { take } = await takeStock(stockKind, panel.회사 || '', row.itemId, log.n, {
      by,
      note: `${why} · ${panel.프로젝트 || panel.id} · ${box}`,
    });
    if (take < log.n) {
      // 모자라면 «꺼낸 만큼 도로 넣고» 멈춘다 — 전에는 꺼낸 뒤 그냥 던져서 그 몫이 증발했다
      // (2026-09-16 야간 조사 S2)
      if (take > 0) {
        await returnStock(stockKind, panel.회사 || '', row.itemId, take, {
          by,
          note: `${why} · ${panel.프로젝트 || panel.id} · ${box} 되돌림`,
        });
      }
      throw new Error(`재고에 ${take}개뿐이라 ${log.n}개를 채울 수 없습니다`);
    }
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
  let myReleased = 0;
  // 「미입고」는 실물이 통으로 돌아간다 — 통에서 가져온 몫까지만. 가져감·제외는 물건이
  // 없어졌거나 다른 호기로 갔으니 통에 안 돌아간다. 전에는 어느 사유든 안 돌려줘서, 수량을
  // 넣었다 뺐다 하면 통이 한 번씩 줄기만 했다 (2026-09-16 대표님 「재고 수량이 증발해버림」)
  let giveBack = 0;
  let tookOurs = 0;
  // 「미입고」(옛 낱말 「그냥 빼기」) = 잘못 채운 것 — 실물은 통에 그대로 있으니 돌려준다
  if (useStock && kind === 'out' && (why === '미입고' || why === '그냥 빼기') && row.itemId) {
    const cur = (await getPanelMaterials(panel.id))?.[box]?.[row.id] || {};
    const cut = Math.min(log.n, Math.max(0, Number(cur.qty) || 0));
    giveBack = Math.min(cut, Math.max(0, Number(cur.fromStock) || 0));
    tookOurs = Math.max(0, Number(cur.fromOurs) || 0);
  }
  if (myDelta) myReleased = (await shift(panel.id, box, row.id, myDelta, by)).released;
  if (giveBack > 0) {
    await returnStock(stockKind, panel.회사 || '', row.itemId, giveBack, {
      by,
      note: `${panel.프로젝트 || panel.id} · ${box} 되돌림`,
      tookOurs,
    });
    if (tookOurs > 0) await addFromOurs(panel.id, box, row.id, -Math.min(giveBack, tookOurs));
  }
  await appendLog(panel.id, box, row.id, log);

  // 상대 호기 — 짝 기록과 수량.
  // 「통에서 온 몫」(fromStock)도 함께 옮긴다. 안 옮기면 받은 호기가 나중에 그만큼을 빼도
  // 통으로 돌아갈 길이 없어 장부에서 사라졌다 (2026-09-16 야간 조사 S5).
  const pair = mateLog(log, panel.id);
  if (pair && log.mate) {
    const d = mateDelta(log);
    if (d) {
      const r = await shift(log.mate, box, row.id, d, by);
      if (d > 0 && myReleased > 0) {
        await addFromStock(log.mate, box, row.id, Math.min(myReleased, r.moved));
      } else if (d < 0 && r.released > 0 && myDelta > 0) {
        await addFromStock(panel.id, box, row.id, Math.min(r.released, myDelta));
      }
    }
    await appendLog(log.mate, box, row.id, pair);
  }
  return log;
}

/** 이력 한 줄 지우기 — 수량은 되돌리지 않는다(지금 수량이 실물이다). 짝도 함께 지운다.
 *  지우기 전에 휴지통에 한 벌 담는다 — 앱에서 유일하게 휴지통을 안 거치던 삭제였다
 *  (2026-09-16 야간 조사 T1) */
export async function removeMatLog(panelId, box, rowId, logId, by = '') {
  const mats = await getPanelMaterials(panelId);
  const list = mats?.[box]?.[rowId]?.log || [];
  const log = list.find((x) => x.id === logId);
  if (!log) return null;
  let mateSnap = null;
  if (log.mate) {
    const mMats0 = await getPanelMaterials(log.mate);
    const pair = (mMats0?.[box]?.[rowId]?.log || []).find((x) => x.pair === log.id);
    if (pair) mateSnap = { panelId: log.mate, log: pair };
  }
  await trashMatLog(
    { panelId, box, rowId, log, mate: mateSnap, title: `${box} 자재 이력`, summary: `${log.kind} · ${log.why}` },
    by,
  ).catch(() => null);
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

/**
 * 줄을 «처음 상태»로 — 입고 0 · 기록 없음 (2026-09-17 대표님 「취소 … 처음 대기상태로」).
 * 무엇이 어디로 가는지는 domain/matUndo 의 undoPlan 이 정한다:
 *   다른 호기에서 가져온 몫 → 그 호기로(통에서 온 몫 표시까지) · 남은 통 몫 → 통으로 · 기록 → 휴지통.
 * 이 줄에서 남에게 보낸 것은 실물이 거기 있으니 두고, 그 사실만 plan.kept 로 돌려준다.
 */
export async function resetMatRow(panel, box, row, { by = '', stockKind = 'paid', useStock = true } = {}) {
  if (!panel?.id || !box || !row?.id) throw new Error('호기·품목이 필요합니다');
  const rec = (await getPanelMaterials(panel.id))?.[box]?.[row.id] || {};
  const plan = undoPlan(rec);
  // ① 다른 호기에서 가져온 몫 → 그 호기로
  for (const m of plan.toMates) {
    await shift(m.mate, box, row.id, m.n, by);
    if (m.fromStock > 0) await addFromStock(m.mate, box, row.id, m.fromStock);
  }
  // ② 남은 통 몫 → 통으로 (당사가 댄 몫은 그만큼 당사로)
  if (useStock && plan.toStock > 0 && row.itemId) {
    await returnStock(stockKind, panel.회사 || '', row.itemId, plan.toStock, {
      by,
      note: `${panel.프로젝트 || panel.id} · ${box} 취소`,
      tookOurs: plan.tookOurs,
    });
  }
  // ③ 기록 전부 휴지통으로 — 짝(상대 호기 쪽)도 같이 정리된다
  for (const l of plan.logs) await removeMatLog(panel.id, box, row.id, l.id, by);
  // ④ 줄 초기화 — 「제외」 표시와 비고는 건드리지 않는다
  await setDoc(
    ref(panel.id, box),
    {
      panelId: panel.id,
      box,
      items: { [row.id]: { qty: 0, fromStock: 0, fromOurs: 0, at: new Date().toISOString().slice(0, 10), by } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return plan;
}
