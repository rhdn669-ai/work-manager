import { describe, it, expect } from 'vitest';
import { freeStockMoves } from '../../src/domain/freeStockSync';

describe('사급 수량을 고치면 통이 어떻게 움직이나', () => {
  it('통에 없는데 체크하면 그만큼 받은 걸로 적고 바로 내보낸다', () => {
    expect(freeStockMoves({ before: 0, after: 16, have: 0, autoIn: 0 })).toEqual({
      receive: 16,
      take: 16,
      giveBack: 0,
      autoIn: 16,
    });
  });

  it('없던 것을 만들었다가 되돌리면 통은 그대로 — 없던 재고가 생기면 안 된다', () => {
    // 2026-09-12 대표님 「없는 수량을 넣었다가 다시빼면 없던 재고가 생겨버림」
    expect(freeStockMoves({ before: 16, after: 0, have: 0, autoIn: 16 })).toEqual({
      receive: 0,
      take: 0,
      giveBack: 0,
      autoIn: 0,
    });
  });

  it('통에 있던 것은 되돌리면 통으로 돌아간다', () => {
    expect(freeStockMoves({ before: 16, after: 0, have: 4, autoIn: 0 })).toEqual({
      receive: 0,
      take: 0,
      giveBack: 16,
      autoIn: 0,
    });
  });

  it('반은 통에서, 반은 만들어 낸 경우 — 통에서 온 만큼만 돌아간다', () => {
    const 넣기 = freeStockMoves({ before: 0, after: 16, have: 10, autoIn: 0 });
    expect(넣기).toEqual({ receive: 6, take: 16, giveBack: 0, autoIn: 6 });
    const 빼기 = freeStockMoves({ before: 16, after: 0, have: 0, autoIn: 6 });
    expect(빼기).toEqual({ receive: 0, take: 0, giveBack: 10, autoIn: 0 });
  });

  it('일부만 되돌리면 만들어 낸 것부터 없앤다', () => {
    expect(freeStockMoves({ before: 16, after: 12, have: 0, autoIn: 6 })).toEqual({
      receive: 0,
      take: 0,
      giveBack: 0,
      autoIn: 2,
    });
  });

  it('통에 넉넉하면 만들어 내지 않는다', () => {
    expect(freeStockMoves({ before: 0, after: 5, have: 20, autoIn: 0 })).toEqual({
      receive: 0,
      take: 5,
      giveBack: 0,
      autoIn: 0,
    });
  });

  it('바뀐 것이 없으면 아무것도 하지 않는다', () => {
    expect(freeStockMoves({ before: 3, after: 3, have: 1, autoIn: 0 })).toBeNull();
  });
});
