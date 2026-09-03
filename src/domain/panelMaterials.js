// 호기 자재 체크의 셈 — 부족분, BOX 완료 판정, 구간 집계
// (2026-09-03 대표님 「사급 도급 구성품 체크 수량」·「호기수 범위 선택해서 뭐가 얼마나 부족한지」).
//
// received: { [bomItemId]: { qty, at, by } } — 그 호기 그 BOX 에 들어온 개수
// rows: BOM 줄 (타입·BOX 로 거른 뒤). 각 줄에 qty(BOM 수량)·itemId(품목 마스터)·supplyType

import { isFreeIssue } from '../services/bomService';

export function receivedQty(received, bomItemId) {
  const r = received && received[bomItemId];
  return Math.max(0, Number(r && r.qty) || 0);
}

/** BOM 수량 - 들어온 개수. 넘치게 들어와도 부족은 0 */
export function shortageOf(bomQty, got) {
  return Math.max(0, (Number(bomQty) || 0) - (Number(got) || 0));
}

/** 한 줄이 다 찼나 — BOM 수량이 0 인 줄은 셈에서 뺀다(수량 미정) */
export function rowDone(row, received) {
  const need = Number(row.qty) || 0;
  if (need <= 0) return true;
  return receivedQty(received, row.id) >= need;
}

/**
 * 그 BOX 의 도급(또는 사급) 구성품이 «전부» 찼나.
 * 해당 구분의 줄이 하나도 없으면 false — 아무것도 없는 것을 「다 들어왔다」고 하면
 * 자재 칸이 저절로 켜져 사람을 속인다.
 */
export function boxKindComplete(rows, received, kind) {
  const list = (rows || []).filter((r) => (kind === 'free' ? isFreeIssue(r) : !isFreeIssue(r)));
  if (list.length === 0) return false;
  return list.every((r) => rowDone(r, received));
}

/** 진행 요약 — 「도급 12/15 · 사급 3/3」 */
export function boxSummary(rows, received) {
  const s = { paid: { done: 0, total: 0 }, free: { done: 0, total: 0 } };
  for (const r of rows || []) {
    const k = isFreeIssue(r) ? 'free' : 'paid';
    s[k].total += 1;
    if (rowDone(r, received)) s[k].done += 1;
  }
  return s;
}

/**
 * 호기 범위의 부족분을 품목 마스터 id 로 합산한다.
 * entries: [{ panelLabel, rows, received }] — 호기마다 그 BOX(들)의 줄과 기록
 * 돌려주는 것: [{ itemId, code, name, spec, supplyType, need, got, short, panels: [label…] }]
 * 호기마다 BOM 이 달라도 같은 품목(itemId)이면 한 줄로 합친다.
 */
export function aggregateShortage(entries) {
  const map = new Map();
  for (const { panelLabel, rows, received } of entries || []) {
    for (const r of rows || []) {
      const need = Number(r.qty) || 0;
      if (need <= 0) continue;
      const got = receivedQty(received, r.id);
      const short = shortageOf(need, got);
      const key = r.itemId || `row:${r.id}`;
      if (!map.has(key)) {
        map.set(key, {
          itemId: r.itemId || '',
          code: r.code || '',
          name: r.name || '',
          spec: r.spec || '',
          supplyType: r.supplyType || '',
          need: 0,
          got: 0,
          short: 0,
          panels: [],
        });
      }
      const a = map.get(key);
      a.need += need;
      a.got += got;
      a.short += short;
      if (short > 0 && panelLabel && !a.panels.includes(panelLabel)) a.panels.push(panelLabel);
    }
  }
  return [...map.values()].filter((a) => a.short > 0).sort((x, y) => y.short - x.short || x.code.localeCompare(y.code));
}
