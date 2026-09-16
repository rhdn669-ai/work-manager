// 호기 자재 체크의 셈 — 부족분, BOX 완료 판정, 구간 집계
// (2026-09-03 대표님 「사급 도급 구성품 체크 수량」·「호기수 범위 선택해서 뭐가 얼마나 부족한지」).
//
// received: { [bomItemId]: { qty, at, by } } — 그 호기 그 BOX 에 들어온 개수
// rows: BOM 줄 (타입·BOX 로 거른 뒤). 각 줄에 qty(BOM 수량)·itemId(품목 마스터)·supplyType

import { isFreeIssue } from '../services/bomService';

export function receivedQty(received, bomItemId) {
  const r = received && received[bomItemId];
  // 음수도 그대로 — 뒤 호기에 빌려준 줄은 0 밑으로 내려가고(빚), 부족이 그만큼 늘어난다
  // (2026-09-15 대표님 「-1/1 이면 부족 2」)
  return Number(r && r.qty) || 0;
}

/** 이 호기에서만 일시 제외한 줄인가 — 기본 BOM 은 그대로 두고 그 호기에서만 뺀다
 *  (2026-09-03 대표님 「기본 틀이 되는 리스트에는 제외하면 안 되고 일시적으로만」) */
export function isSkipped(received, bomItemId) {
  return !!(received && received[bomItemId] && received[bomItemId].skip);
}

/** BOM 수량 - 들어온 개수. 넘치게 들어와도 부족은 0 */
export function shortageOf(bomQty, got) {
  return Math.max(0, (Number(bomQty) || 0) - (Number(got) || 0));
}

/** 한 줄이 다 찼나 — BOM 수량이 0 인 줄은 셈에서 뺀다(수량 미정) */
export function rowDone(row, received) {
  const need = Number(row.qty) || 0;
  if (need <= 0) return true;
  if (isSkipped(received, row.id)) return true;
  return receivedQty(received, row.id) >= need;
}

/**
 * 그 BOX 의 도급(또는 사급) 구성품이 «전부» 찼나.
 * 해당 구분의 줄이 하나도 없으면 false — 아무것도 없는 것을 「다 들어왔다」고 하면
 * 자재 칸이 저절로 켜져 사람을 속인다.
 */
// kind: 'paid' | 'free' | 'made'(판금)
// 판금은 사급·도급보다 «먼저» 가른다 — 판금으로 표시된 품목은 도급·사급 어느 쪽도 아니다
// (2026-09-12 대표님 「판금으로 명칭 하자」). isMadeRow 를 주지 않으면 판금은 없는 셈이다.
export function boxKindComplete(rows, received, kind, isMadeRow = null) {
  const made = (r) => (isMadeRow ? isMadeRow(r) : false);
  const list = (rows || []).filter((r) => {
    if (made(r)) return kind === 'made';
    if (kind === 'made') return false;
    return kind === 'free' ? isFreeIssue(r) : !isFreeIssue(r);
  });
  if (list.length === 0) return false;
  return list.every((r) => rowDone(r, received));
}

/** 진행 요약 — 「도급 12/15 · 사급 3/3」 */
// received 는 기록 사전이거나, 「줄을 주면 그 줄의 BOX 기록을 돌려주는 함수」다 —
// BOX 「전체」 보기에서는 줄마다 속한 BOX 가 달라 사전 하나로는 셀 수 없다 (2026-09-16)
export function boxSummary(rows, received, isMadeRow = null) {
  const s = { paid: { done: 0, total: 0 }, free: { done: 0, total: 0 }, made: { done: 0, total: 0 } };
  const recOf = typeof received === 'function' ? received : () => received;
  for (const r of rows || []) {
    const k = isMadeRow && isMadeRow(r) ? 'made' : isFreeIssue(r) ? 'free' : 'paid';
    s[k].total += 1;
    if (rowDone(r, recOf(r))) s[k].done += 1;
  }
  return s;
}

/**
 * 호기 범위의 부족분을 품목 마스터 id 로 합산한다.
 * entries: [{ panelLabel, rows, received }] — 호기마다 그 BOX(들)의 줄과 기록
 * 돌려주는 것: [{ itemId, code, name, spec, supplyType, need, got, short, panels: [label…] }]
 * 호기마다 BOM 이 달라도 같은 품목(itemId)이면 한 줄로 합친다.
 */
// onlyShort=false 면 모자라지 않은 품목도 함께 돌려준다 —
// 사급 재고 화면은 「BOM 에 있는 사급 품목 전부」를 보여 주어야 하기 때문 (2026-09-10 대표님)
export function aggregateShortage(entries, { onlyShort = true } = {}) {
  const map = new Map();
  for (const { panelLabel, rows, received } of entries || []) {
    for (const r of rows || []) {
      const need = Number(r.qty) || 0;
      if (need <= 0) continue;
      if (isSkipped(received, r.id)) continue; // 그 호기에서 일시 제외한 줄은 부족이 아니다
      const got = receivedQty(received, r.id);
      const short = shortageOf(need, got);
      const key = r.itemId || `row:${r.id}`;
      if (!map.has(key)) {
        map.set(key, {
          itemId: r.itemId || '',
          code: r.code || '',
          drawingNo: r.drawingNo || '', // 사급 재고 표가 도번 칸을 쓴다 (안 담으면 빈칸)
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
  return [...map.values()]
    .filter((a) => !onlyShort || a.short > 0)
    .sort((x, y) => y.short - x.short || x.code.localeCompare(y.code));
}
