// 도급 세트 — 우리가 사서 넣는 도급 자재를 「한 호기분 = 1세트」로 세는 셈
// (2026-09-03 대표님 「몇 세트가 입고돼 있고 어디 호기에 배정할지」).
//
// 세트 수는 가장 모자란 품목이 정한다. 발주서 입고 합에서 이미 배정한 세트가 쓴 만큼을
// 빼고, 세트당 수량으로 나눈 몫 가운데 최솟값이다.
import { isFreeIssue } from '../services/bomService';

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
 * → { sets, assigned, items:[…], limiter, unlinked }
 */
export function computeSets({ rows, receivedByItem = {}, assigned = 0, master = {} }) {
  const { byItem, unlinked } = perSetByItem(rows);
  const items = [];
  let sets = Infinity;
  let limiter = null;
  for (const [itemId, { perSet, sample }] of byItem) {
    const received = Number(receivedByItem[itemId]) || 0;
    const consumed = perSet * assigned;
    const spare = received - consumed;
    const setsFrom = Math.max(0, Math.floor(spare / perSet));
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
    });
    if (setsFrom < sets) {
      sets = setsFrom;
      limiter = itemId;
    }
  }
  if (items.length === 0) {
    sets = 0;
    limiter = null;
  }
  // 세트를 막는 것부터 — 같은 세트 수면 코드순
  items.sort((a, b) => a.setsFrom - b.setsFrom || a.code.localeCompare(b.code));
  return { sets, assigned, items, limiter, unlinked };
}

/** 배정 대상 호기 — 그 회사, BOM 연결됨, 시작 호기 번호 이상. 번호순 */
export function eligiblePanels(panels, { company, startProject }) {
  const start = panelSeq(startProject);
  return (panels || [])
    .filter((p) => (!company || !p.회사 || p.회사 === company) && p.bomLink?.projectId)
    .filter((p) => start < 0 || panelSeq(p.프로젝트) >= start)
    .sort(
      (a, b) => panelSeq(a.프로젝트) - panelSeq(b.프로젝트) || String(a.프로젝트).localeCompare(String(b.프로젝트)),
    );
}

/** 같은 BOM(프로젝트·타입)을 쓰는 호기끼리 묶는다 — 세트는 타입마다 따로 센다 */
export function groupKey(p) {
  return `${p.bomLink?.projectId || ''}|${p.bomLink?.variantKey || ''}`;
}
