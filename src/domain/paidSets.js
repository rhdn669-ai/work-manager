// 도급 세트 — 우리가 사서 넣는 도급 자재를 「한 호기분 = 1세트」로 세는 셈
// (2026-09-03 대표님 「몇 세트가 입고돼 있고 어디 호기에 배정할지」).
//
// 세트 수는 가장 모자란 품목이 정한다. 발주서 입고 합에서 이미 배정한 세트가 쓴 만큼을
// 빼고, 세트당 수량으로 나눈 몫 가운데 최솟값이다.
import { isFreeIssue } from '../services/bomService';
import { CHECKABLE_BOXES } from './panelBom';

/** 호기 이름 끝 숫자 — YS-TEPS0926273 → 926273. 없으면 -1 */
export function panelSeq(name) {
  const m = String(name || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : -1;
}

/**
 * BOM 도급 줄을 품목(itemId)별로 묶어 세트당 수량을 낸다 — 같은 품목이 여러 BOX 에 있으면 합친다.
 * itemId 가 없는 손으로 적은 줄은 셀 수 없어 뺀다(따로 알린다).
 */
export function perSetByItem(rows) {
  const out = new Map(); // itemId → { perSet, sample }
  let unlinked = 0;
  for (const r of rows || []) {
    if (isFreeIssue(r)) continue;
    const q = Number(r.qty) || 0;
    if (q <= 0) continue;
    if (!r.itemId) {
      unlinked += 1;
      continue;
    }
    const cur = out.get(r.itemId) || { perSet: 0, sample: r };
    cur.perSet += q;
    out.set(r.itemId, cur);
  }
  return { byItem: out, unlinked };
}

/**
 * 세트 계산.
 *   rows           BOM 줄(타입 걸러진 것)
 *   receivedByItem { itemId: 발주서 입고 합 }
 *   assigned       이미 배정한 세트 수
 *   master         { itemId: 품목 마스터 } (코드·품명·규격 표시용, 없어도 됨)
 *   exclude        세트 셈에서 뺀 품목 id 들 (세트로 안 사는 것 — 통신케이블처럼 따로 사는 품목)
 *   consumedByItem 배정한 호기들이 실제로 가져간 양 { itemId: qty } — 주면 이것을 쓰고,
 *                  없으면 세트당 × 배정 수로 어림한다
 * → { sets, assigned, items:[…], limiter, unlinked }
 */
export function computeSets({
  rows,
  receivedByItem = {},
  assigned = 0,
  master = {},
  exclude = [],
  consumedByItem = null,
}) {
  const { byItem, unlinked } = perSetByItem(rows);
  const skip = new Set(exclude || []);
  const items = [];
  let sets = Infinity;
  let limiter = null;
  for (const [itemId, { perSet, sample }] of byItem) {
    const received = Number(receivedByItem[itemId]) || 0;
    const consumed = consumedByItem ? Number(consumedByItem[itemId]) || 0 : perSet * assigned;
    const spare = received - consumed;
    const setsFrom = Math.max(0, Math.floor(spare / perSet));
    const excluded = skip.has(itemId);
    const m = master[itemId] || {};
    items.push({
      itemId,
      code: m.code || sample.code || '',
      name: m.name || sample.name || '',
      spec: m.spec || sample.spec || '',
      perSet,
      received,
      consumed,
      spare,
      setsFrom,
      excluded,
    });
    if (!excluded && setsFrom < sets) {
      sets = setsFrom;
      limiter = itemId;
    }
  }
  if (!Number.isFinite(sets)) {
    sets = 0;
    limiter = null;
  }
  // 세트를 막는 것부터(제외한 것은 맨 아래) — 같은 세트 수면 코드순
  items.sort(
    (a, b) => Number(a.excluded) - Number(b.excluded) || a.setsFrom - b.setsFrom || a.code.localeCompare(b.code),
  );
  return { sets, assigned, items, limiter, unlinked };
}

/** 배정 대상 호기 — 그 회사, BOM 연결됨, 시작 호기 번호 이상.
 *  차례는 «생산현황 목록 그대로»(손으로 끈 순서 → 납기순) — 번호순으로 다시 세우지 않는다
 *  (2026-09-04 대표님 「번호순 아니고 생산현황 리스트 순」) */
export function eligiblePanels(panels, { company, startProject }) {
  const start = panelSeq(startProject);
  return (panels || [])
    .filter((p) => (!company || !p.회사 || p.회사 === company) && p.bomLink?.projectId)
    .filter((p) => start < 0 || panelSeq(p.프로젝트) >= start);
}

/** 같은 BOM(프로젝트·타입)을 쓰는 호기끼리 묶는다 — 세트는 타입마다 따로 센다 */
export function groupKey(p) {
  return `${p.bomLink?.projectId || ''}|${p.bomLink?.variantKey || ''}`;
}

/** 배정한 호기들의 도급 줄이 실제로 가져간 양 — materialsList: [{ [box]: { [rowId]: {qty} } }] */
export function consumedByItem(rows, materialsList) {
  const rowItem = new Map((rows || []).filter((r) => r.itemId && !isFreeIssue(r)).map((r) => [r.id, r.itemId]));
  const out = {};
  for (const mats of materialsList || []) {
    for (const items of Object.values(mats || {})) {
      for (const [rowId, v] of Object.entries(items || {})) {
        const itemId = rowItem.get(rowId);
        if (!itemId) continue;
        out[itemId] = (out[itemId] || 0) + (Number(v?.qty) || 0);
      }
    }
  }
  return out;
}

/**
 * 채우기 계획 — 있는 만큼만 (2026-09-03 대표님 「부족한 게 있는데 세트 배정하면」).
 *   rows        BOM 줄(타입 걸러진 것; 사급은 건너뜀)
 *   spareByItem { itemId: 지금 여유 }  제외한 품목은 여유와 무관하게 BOM 수량대로
 *   current     { rowId: 이미 들어온 개수 } (부족분 채우기 때)
 *   skipRows    이 호기에서 일시 제외한 줄 id 들 — 채우지도, 부족으로 세지도 않는다
 * → { lines: [{ id, box, itemId, need, have, add, total, short }], short: 부족 줄 수, boxes: { [box]: full } }
 */
export function fillPlan({ rows, spareByItem = {}, exclude = [], current = {}, skipRows = [] }) {
  const skip = new Set(exclude || []);
  const skippedRow = new Set(skipRows || []);
  const left = { ...spareByItem };
  const lines = [];
  const boxes = {};
  let shortCount = 0;
  for (const r of rows || []) {
    if (isFreeIssue(r)) continue;
    if (skippedRow.has(r.id)) {
      const box = r.box || '';
      boxes[box] = boxes[box] ?? true;
      continue;
    }
    const need = Number(r.qty) || 0;
    const have = Math.min(need, Number(current[r.id]) || 0);
    const want = Math.max(0, need - have);
    let add = want;
    if (!skip.has(r.itemId) && r.itemId) {
      const avail = Math.max(0, Number(left[r.itemId]) || 0);
      add = Math.min(want, avail);
      left[r.itemId] = avail - add;
    }
    const total = have + add;
    const short = need - total;
    if (short > 0) shortCount += 1;
    const box = r.box || '';
    boxes[box] = (boxes[box] ?? true) && short <= 0;
    lines.push({ id: r.id, box, itemId: r.itemId || '', need, have, add, total, short });
  }
  return { lines, short: shortCount, boxes };
}

/** 배정된 호기 하나의 부족 — { short: 줄 수, lines: 부족 줄 } (materials: { [box]: items }) */
export function panelShortage(rows, materials) {
  const out = [];
  for (const r of rows || []) {
    // 세트가 채우는 줄과 같은 범위 — BOX 가 없거나 MP 인 줄은 체크 대상이 아니다
    if (isFreeIssue(r) || !CHECKABLE_BOXES.includes(String(r.box || '').trim())) continue;
    const rec = materials?.[r.box || '']?.[r.id];
    if (rec?.skip) continue; // 이 호기에서 일시 제외
    const need = Number(r.qty) || 0;
    const got = Number(rec?.qty) || 0;
    if (got < need) out.push({ id: r.id, itemId: r.itemId || '', box: r.box || '', need, got, short: need - got });
  }
  return { short: out.length, lines: out };
}
