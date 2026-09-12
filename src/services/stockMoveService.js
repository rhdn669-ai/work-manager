// 사급이던 품목을 도급으로 옮긴다 — 재고 화면과 BOM 화면이 같은 셈을 쓰도록 한 곳에 둔다.
// (2026-09-12 대표님 「곧 사급품목도 도급으로변경 예정인 품목들이 있는데 그땐 어떻게합칠예정?」)
//
// BOM 줄만 도급으로 바꾸면 숫자가 끊긴다. 도급 재고는 「발주 입고 + 손으로 적은 몫 − 나감」인데,
// 예전에 사급으로 받아 쓴 것은 발주서가 없어 들어옴이 0 이고 나감만 따라와 남음이 음수가 된다.
// 게다가 사급 통에 남아 있던 수량은 그 품목이 사급 목록에서 사라지며 갈 곳을 잃는다.
//
// 그래서 «남은 양 + 지금까지 나간 양»을 도급 쪽에 얹는다.
//   옮긴 뒤 도급 남음 = 0 − 나간 양 + (남은 양 + 나간 양) = 남은 양   ← 옮기기 전과 같다
import { getFreeStockSplit, setFreeStockQty } from './freeStockService';
import { receivePaidStock } from './paidStockService';
import { getPanelMaterials } from './panelMaterialsService';
import { subscribePanels } from './productionService';
import { getBomBySite, bomItemsForVariant } from './bomService';
import { CHECKABLE_BOXES, bomRowsForBox } from '../domain/panelBom';
import { receivedQty } from '../domain/panelMaterials';

/** 구독을 한 번만 받아 끊는다 — 목록을 그때그때 읽을 때 쓴다 */
function once(subscribe) {
  return new Promise((resolve) => {
    let unsub = null;
    let done = false;
    unsub = subscribe((rows) => {
      if (done) return;
      done = true;
      resolve(rows || []);
      if (typeof unsub === 'function') setTimeout(unsub, 0);
    });
  });
}

/**
 * 그 회사 호기들이 이 품목들을 지금까지 얼마나 가져갔나 — { itemId: 나간 양 }
 * 끝난 호기도 센다. 나간 자재는 호기가 출고됐다고 돌아오지 않는다.
 */
export async function goneByItem(company, itemIds) {
  const want = new Set(itemIds || []);
  if (want.size === 0) return {};
  const panels = await once(subscribePanels);
  const mine = panels.filter((p) => (!p.회사 || p.회사 === company) && p?.bomLink?.projectId);
  const bomCache = new Map();
  const out = {};
  for (const p of mine) {
    const pid = p.bomLink.projectId;
    if (!bomCache.has(pid)) bomCache.set(pid, (await getBomBySite(pid)) || []);
    const forVariant = bomItemsForVariant(bomCache.get(pid), p.bomLink.variantKey || '');
    const mats = await getPanelMaterials(p.id);
    for (const box of CHECKABLE_BOXES) {
      const rec = mats?.[box] || {};
      for (const r of bomRowsForBox(forVariant, box)) {
        if (!r.itemId || !want.has(r.itemId)) continue;
        out[r.itemId] = (out[r.itemId] || 0) + receivedQty(rec, r.id);
      }
    }
  }
  return out;
}

/**
 * 사급 → 도급 옮기기.
 * @param company 회사(메티스·디에이치)
 * @param items   [{ itemId, code, name, spec, drawingNo }]
 * @param gone    { itemId: 나간 양 } — 이미 셈해 두었으면 넘긴다(화면이 알고 있을 때)
 * @returns { moved, total } moved 옮긴 품목 수, total 도급으로 넘어간 개수 합
 */
export async function moveFreeToPaid(company, items, { by = '', gone = null } = {}) {
  const list = (items || []).filter((it) => it?.itemId);
  if (list.length === 0 || !company) return { moved: 0, total: 0 };
  const out =
    gone ||
    (await goneByItem(
      company,
      list.map((it) => it.itemId),
    ));
  let total = 0;
  for (const it of list) {
    const { qty } = await getFreeStockSplit(company, it.itemId);
    const move = Math.max(0, qty + (Number(out[it.itemId]) || 0));
    if (move > 0) {
      await receivePaidStock(company, it, move, { by, note: '사급에서 옮김' });
      total += move;
    }
    // 우리가 댄 몫도 함께 간다 — 도급은 어차피 우리 것이다 (대표님 「2ㅇㅇ」)
    await setFreeStockQty(company, it, 0, { by, reason: '도급으로 옮김', ours: 0 });
  }
  return { moved: list.length, total };
}
