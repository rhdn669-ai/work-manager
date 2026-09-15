// 분실·파손 장부 저장 — 사건은 «사건이 난 호기의 그 줄 기록»에 붙는다. (2026-09-15 대표님)
//
// 등록: 사건 난 호기 줄에 incidents[] 추가 + 빌려준 호기(없으면 사건 난 호기) 그 줄 수량 −n.
//       빌려준 줄이 통에서 가져온 몫(fromStock)도 −n — 그 부품은 이제 사건 난 호기에 붙어 있다.
// 종료: 파손은 「수리 입고」 → 통 +n. 분실은 「입고됨」 → 닫기만 (재구매 입고가 통을 이미 올렸다).
// 배열은 통째로 바꿔 쓴다 — 서버 merge 규칙(배열은 교체)과 같다.
import { doc, setDoc, serverTimestamp } from '../config/data';
import { db } from '../config/data';
import { getPanelMaterials, materialsDocId, setReceived, addFromStock } from './panelMaterialsService';
import { returnStock } from './stockService';
import { newIncident, isOpen } from '../domain/incidents';

const ref = (panelId, box) => doc(db, 'panelMaterials', materialsDocId(panelId, box));

async function writeIncidents(panelId, box, rowId, incidents) {
  await setDoc(
    ref(panelId, box),
    { panelId, box, items: { [rowId]: { incidents } }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * 사건 등록.
 * @param panel   사건이 난 호기 (id 필요)
 * @param box     BOX 이름
 * @param row     BOM 줄 { id, qty }
 * @param opts    { reason, n, from(빌려준 호기 id), by, note }
 */
export async function addIncident(panel, box, row, { reason, n = 1, from = '', by = '', note = '' } = {}) {
  if (!panel?.id || !box || !row?.id) throw new Error('호기·BOX·품목이 필요합니다');
  const inc = newIncident({ reason, n, from, by, note });
  const mats = await getPanelMaterials(panel.id);
  const cur = mats?.[box]?.[row.id] || {};
  await writeIncidents(panel.id, box, row.id, [...(cur.incidents || []), inc]);

  // 빈자리 — 빌려준 호기 줄이 −n, 안 골랐으면 사건 난 호기 줄이 −n
  const holePanelId = from || panel.id;
  const holeMats = holePanelId === panel.id ? mats : await getPanelMaterials(holePanelId);
  const holeRec = holeMats?.[box]?.[row.id] || {};
  const before = Math.max(0, Number(holeRec.qty) || 0);
  const after = Math.max(0, before - inc.n);
  if (after !== before) {
    await setReceived(holePanelId, box, row.id, after, by);
    const kept = Math.max(0, Number(holeRec.fromStock) || 0);
    if (kept > 0) await addFromStock(holePanelId, box, row.id, -Math.min(kept, before - after), kept);
  }
  return inc;
}

/**
 * 사건 닫기 — 파손은 수리품이 돌아온 것이라 통 +n (kind·company·item 을 주면), 분실은 닫기만.
 */
export async function closeIncident(panelId, box, rowId, incidentId, { by = '', stock = null } = {}) {
  const mats = await getPanelMaterials(panelId);
  const cur = mats?.[box]?.[rowId] || {};
  const list = cur.incidents || [];
  const inc = list.find((x) => x.id === incidentId);
  if (!inc || !isOpen(inc)) return null;
  const done = { ...inc, status: 'done', doneAt: new Date().toISOString().slice(0, 10), doneBy: by };
  await writeIncidents(
    panelId,
    box,
    rowId,
    list.map((x) => (x.id === incidentId ? done : x)),
  );
  if (inc.reason === '파손' && stock?.kind && stock?.company && stock?.itemId) {
    await returnStock(stock.kind, stock.company, stock.itemId, inc.n, { by, note: '수리 입고' });
  }
  return done;
}
