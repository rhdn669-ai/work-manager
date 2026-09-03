// BOM 합계 — 카드와 상세가 같은 셈 (2026-09-03 대표님).
import { describe, it, expect } from 'vitest';
import { bomStats, unitPriceOf } from '../../src/domain/bomStats';

describe('BOM 합계', () => {
  const price = new Map([['A', 100], ['Z', 0]]);
  it('사급은 금액에서 빠지고 수량·품목 수에는 든다', () => {
    const s = bomStats(
      [
        { itemId: 'A', qty: 2, unitPrice: 999 },
        { itemId: 'A', qty: 3, unitPrice: 999, supplyType: 'free' },
      ],
      price,
    );
    expect(s).toEqual({ count: 2, qty: 5, amount: 200, freeCount: 1, paidCount: 1 });
  });
  it('단가는 마스터 표준단가 우선, 없으면 줄의 단가', () => {
    expect(unitPriceOf({ itemId: 'A', unitPrice: 5 }, price)).toBe(100);
    expect(unitPriceOf({ itemId: 'B', unitPrice: 5 }, price)).toBe(5);
    expect(unitPriceOf({ unitPrice: 7 }, price)).toBe(7);
    // 표준단가가 0 이면 0 (줄 단가로 되돌아가지 않는다 — 상세 화면과 같은 규칙)
    expect(unitPriceOf({ itemId: 'Z', unitPrice: 5 }, price)).toBe(0);
  });
  it('빈 목록', () => {
    expect(bomStats([], price).amount).toBe(0);
  });
});
