import { describe, it, expect } from 'vitest';
import { ledgerOn, stockKindOf } from '../../src/domain/stockLedger';

describe('재고 통이 실값인가 — 갈래·회사마다', () => {
  it('사급은 늘 실값', () => {
    expect(ledgerOn({}, '메티스', 'free')).toBe(true);
    expect(ledgerOn(undefined, '', 'free')).toBe(true);
  });
  it('도급·판금은 굳힌 회사·갈래만', () => {
    const s = { 메티스: { stockLedger: { paid: true } } };
    expect(ledgerOn(s, '메티스', 'paid')).toBe(true);
    expect(ledgerOn(s, '메티스', 'made')).toBe(false);
    expect(ledgerOn(s, '디에이치', 'paid')).toBe(false);
    expect(ledgerOn({}, '메티스', 'paid')).toBe(false);
  });
  it('BOM 줄의 갈래 키', () => {
    expect(stockKindOf({ supplyType: '' })).toBe('paid');
    expect(stockKindOf({ supplyType: 'free' })).toBe('free');
    expect(stockKindOf({ supplyType: 'made' })).toBe('made');
    expect(stockKindOf({})).toBe('paid');
  });
});
