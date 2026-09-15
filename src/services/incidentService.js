// 분실·파손 장부 저장 — 사건은 «사건이 난 호기의 그 줄 기록»에 붙는다. (2026-09-15 대표님)
//
// 등록: 사건 난 호기 줄에 incidents[] 추가 + 빌려준 호기(없으면 사건 난 호기) 그 줄 수량 −n.
//       빌려준 줄이 통에서 가져온 몫(fromStock)도 −n — 그 부품은 이제 사건 난 호기에 붙어 있다.
// 종료: 파손은 「수리 입고」 → 통 +n. 분실은 「입고됨」 → 닫기만 (재구매 입고가 통을 이미 올렸다).
// 배열은 통째로 바꿔 쓴다 — 서버 merge 규칙(배열은 교체)과 같다.
import { collection, doc, addDoc, setDoc, serverTimestamp } from '../config/data';
import { db } from '../config/data';
import { getPanelMaterials, materialsDocId, setReceived, addFromStock } from './panelMaterialsService';
import { returnStock } from './stockService';
import { newIncident, isOpen } from '../domain/incidents';

const ref = (panelId, box) => doc(db, 'panelMaterials', materialsDocId(panelId, box));
const trashRef = collection(db, 'trash');

/** 빈자리 호기 줄의 수량을 delta 만큼 — 음수면 빌려 감(통에서 온 몫도 같이 줄임), 양수면 되돌림 */
export async function shiftHole(panelId, box, rowId, delta, by = '') {
  const d = Number(delta) || 0;
  if (!d || !panelId) return;
  const mats = await getPanelMaterials(panelId);
  const rec = mats?.[box]?.[rowId] || {};
  const before = Math.max(0, Number(rec.qty) || 0);
  // 없는 데서 빼지 않는다 — 아직 배정 안 한 호기에서 「빌려 왔다」는 말이 안 된다
  // (2026-09-15 대표님 「아직 호기에 배정을 안했는데 어떻게 차용이 가능하지?」)
  if (d < 0 && before < -d) throw new Error(`그 호기 줄에는 ${before}개뿐이라 ${-d}개를 빌려 올 수 없습니다`);
  const after = Math.max(0, before + d);
  if (after === before) return;
  await setReceived(panelId, box, rowId, after, by);
  if (d < 0) {
    const kept = Math.max(0, Number(rec.fromStock) || 0);
    if (kept > 0) await addFromStock(panelId, box, rowId, -Math.min(kept, before - after), kept);
  }
}

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
  // 빈자리부터 뺀다 — 못 빼면(그 호기에 부품이 없음) 사건도 안 적는다
  await shiftHole(from || panel.id, box, row.id, -inc.n, by);
  const mats = await getPanelMaterials(panel.id);
  const cur = mats?.[box]?.[row.id] || {};
  await writeIncidents(panel.id, box, row.id, [...(cur.incidents || []), inc]);
  return inc;
}

/**
 * 열린 사건 고치기 — 수량·사유·빌려온 호기·비고. 빈자리가 바뀌면 옛 자리에 되돌리고 새 자리에서 뺀다.
 */
export async function updateIncident(panelId, box, rowId, incidentId, patch, { by = '' } = {}) {
  const mats = await getPanelMaterials(panelId);
  const list = mats?.[box]?.[rowId]?.incidents || [];
  const old = list.find((x) => x.id === incidentId);
  if (!old || !isOpen(old)) return null;
  const next = {
    ...old,
    reason: patch.reason || old.reason,
    n: Math.max(1, Number(patch.n ?? old.n) || 1),
    from: patch.from ?? old.from ?? '',
    note: String(patch.note ?? old.note ?? '').trim(),
  };
  await writeIncidents(
    panelId,
    box,
    rowId,
    list.map((x) => (x.id === incidentId ? next : x)),
  );
  const oldHole = old.from || panelId;
  const newHole = next.from || panelId;
  if (oldHole !== newHole || old.n !== next.n) {
    await shiftHole(oldHole, box, rowId, +old.n, by);
    await shiftHole(newHole, box, rowId, -next.n, by);
  }
  return next;
}

/**
 * 사건 지우기 — 휴지통으로. 열린 사건이면 빈자리 호기 줄에 n 을 되돌린다.
 * (닫힌 파손 사건은 수리 입고로 통이 이미 올라간 상태라 숫자는 건드리지 않는다)
 */
export async function removeIncident(panelId, box, rowId, incidentId, { by = '', title = '' } = {}) {
  const mats = await getPanelMaterials(panelId);
  const list = mats?.[box]?.[rowId]?.incidents || [];
  const inc = list.find((x) => x.id === incidentId);
  if (!inc) return null;
  await addDoc(trashRef, {
    type: 'panelIncidents',
    refId: inc.id,
    title: title || `${inc.reason} ${inc.n}개`,
    summary: inc.note || '',
    payload: { panelId, box, rowId, inc },
    deletedAt: new Date(),
    deletedByName: by,
  });
  await writeIncidents(
    panelId,
    box,
    rowId,
    list.filter((x) => x.id !== incidentId),
  );
  if (isOpen(inc)) await shiftHole(inc.from || panelId, box, rowId, +inc.n, by);
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
