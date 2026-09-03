// BOM 프로젝트 합계 — 목록 카드와 상세 화면이 «같은 셈»을 쓴다
// (2026-09-03 대표님 「카드에서 보는 금액과 안에서 보는 금액이 다름」).
//
//   단가   품목 마스터의 표준단가가 있으면 그것, 없으면 BOM 줄에 적힌 단가
//   금액   사급(고객사 제공)은 우리 돈이 안 나가므로 뺀다 — 상세 화면의 「예상 합계」와 같은 기준
//   수량   사급도 센다 (실제로 쓰는 자재라 「몇 개 필요한가」는 유효)
import { isFreeIssue } from '../services/bomService';

/** 줄 하나의 단가 — priceById: Map(itemId → 표준단가) */
export function unitPriceOf(row, priceById) {
  const m = row?.itemId && priceById ? priceById.get(row.itemId) : undefined;
  if (m !== undefined && m !== null && m !== '') return Number(m) || 0;
  return Number(row?.unitPrice) || 0;
}

/** → { count, qty, amount, freeCount, paidCount } */
export function bomStats(items, priceById) {
  const out = { count: 0, qty: 0, amount: 0, freeCount: 0, paidCount: 0 };
  for (const b of items || []) {
    const q = Number(b.qty) || 0;
    out.count += 1;
    out.qty += q;
    if (isFreeIssue(b)) {
      out.freeCount += 1;
      continue;
    }
    out.paidCount += 1;
    out.amount += q * unitPriceOf(b, priceById);
  }
  return out;
}
