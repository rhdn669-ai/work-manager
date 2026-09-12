import { describe, it, expect } from 'vitest';
import { MADE, PAID, FREE, MADE_TYPE, isMade, kindOf, kindLabel, nextKind, inKindTab } from '../../src/domain/itemKind';

describe('BOM 줄의 갈래 — 도급·사급·판금', () => {
  const 도급 = { supplyType: PAID };
  const 사급 = { supplyType: FREE };
  const 판금 = { supplyType: MADE_TYPE };

  it('담긴 자리가 곧 구분이다', () => {
    expect(kindOf(도급)).toBe('paid');
    expect(kindOf(사급)).toBe('free');
    expect(kindOf(판금)).toBe('made');
    expect(kindOf({})).toBe('paid'); // 안 적혔으면 도급
  });

  it('판금인지 가린다', () => {
    expect(isMade(판금)).toBe(true);
    expect(isMade(사급)).toBe(false);
    expect(isMade(도급)).toBe(false);
  });

  it('이름을 돌려준다', () => {
    expect(kindLabel(판금)).toBe(MADE);
    expect(kindLabel(사급)).toBe('사급');
    expect(kindLabel(도급)).toBe('도급');
  });

  it('누를 때마다 도급 → 사급 → 판금 → 도급 (대표님 「누를 때마다 돌아가게」)', () => {
    expect(nextKind(도급)).toBe(FREE);
    expect(nextKind(사급)).toBe(MADE_TYPE);
    expect(nextKind(판금)).toBe(PAID);
  });

  it('탭으로 거른다 — 판금은 도급에도 사급에도 안 든다', () => {
    expect(inKindTab(판금, 'made')).toBe(true);
    expect(inKindTab(판금, 'paid')).toBe(false);
    expect(inKindTab(판금, 'free')).toBe(false);
    expect(inKindTab(판금, 'all')).toBe(true);
    expect(inKindTab(도급, 'paid')).toBe(true);
    expect(inKindTab(사급, 'free')).toBe(true);
  });
});
