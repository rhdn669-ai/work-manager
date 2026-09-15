import { describe, it, expect } from 'vitest';
import { stockMoves } from '../../src/domain/stockSync';

describe('사급 수량을 고치면 재고가 어떻게 움직이나', () => {
  it('재고에 있으면 그만큼 꺼내 쓰고, 꺼낸 양을 적어 둔다', () => {
    expect(stockMoves({ before: 0, after: 4, have: 10, fromStock: 0 })).toEqual({
      take: 4,
      giveBack: 0,
      fromStock: 4,
    });
  });

  it('재고가 비어 있으면 아무것도 하지 않는다 — 실물이 직접 온 몫이다', () => {
    expect(stockMoves({ before: 0, after: 16, have: 0, fromStock: 0 })).toBeNull();
  });

  it('재고보다 많이 적으면 있는 만큼만 꺼낸다', () => {
    expect(stockMoves({ before: 0, after: 16, have: 10, fromStock: 0 })).toEqual({
      take: 10,
      giveBack: 0,
      fromStock: 10,
    });
  });

  it('★ 재고에서 가져온 적이 없으면 지워도 재고가 늘지 않는다', () => {
    // 2026-09-12 대표님 「재고에서 가져온 수량이 아니면 다시 제거해도 재고로 채워지면 안되지」
    expect(stockMoves({ before: 16, after: 0, have: 0, fromStock: 0 })).toBeNull();
  });

  it('재고에서 꺼내 썼던 만큼만 돌아간다', () => {
    expect(stockMoves({ before: 16, after: 0, have: 0, fromStock: 10 })).toEqual({
      take: 0,
      giveBack: 10,
      fromStock: 0,
    });
  });

  it('일부만 지우면 그만큼만 돌아간다', () => {
    expect(stockMoves({ before: 16, after: 12, have: 0, fromStock: 10 })).toEqual({
      take: 0,
      giveBack: 4,
      fromStock: 6,
    });
  });

  it('꺼내 쓴 것보다 많이 지워도 꺼낸 만큼까지만 돌아간다', () => {
    expect(stockMoves({ before: 16, after: 0, have: 0, fromStock: 3 })).toEqual({
      take: 0,
      giveBack: 3,
      fromStock: 0,
    });
  });

  it('바뀐 것이 없으면 아무것도 하지 않는다', () => {
    expect(stockMoves({ before: 3, after: 3, have: 1, fromStock: 1 })).toBeNull();
  });
});
