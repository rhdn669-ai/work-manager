import { describe, it, expect } from 'vitest';
import { deriveStatus } from '../../src/services/purchaseService';

describe('발주 상태는 입고 수량에서 나온다', () => {
  const 줄 = (qty, got) => ({ qty, receivedQty: got });

  it('전부 들어오면 입고완료', () => {
    expect(deriveStatus([줄(3, 3), 줄(2, 2)], 'ordered')).toBe('received');
  });

  it('일부만 들어오면 부분입고', () => {
    expect(deriveStatus([줄(3, 3), 줄(2, 0)], 'ordered')).toBe('partial');
  });

  it('하나도 안 들어오면 발주', () => {
    expect(deriveStatus([줄(3, 0), 줄(2, 0)], 'ordered')).toBe('ordered');
  });

  it('★ 창고 재고로 전량 채운 줄(수량 0)이 있어도 나머지가 들어오면 입고완료', () => {
    // 2026-09-12 조사: 수량 0 인 줄 하나 때문에 「부분입고」에 영영 갇혀 정산이 막혔다
    expect(deriveStatus([줄(0, 0), 줄(2, 2)], 'ordered')).toBe('received');
  });

  it('수량 0 인 줄이 있고 나머지가 덜 들어오면 부분입고', () => {
    expect(deriveStatus([줄(0, 0), 줄(2, 1)], 'ordered')).toBe('partial');
  });

  it('정산까지 끝난 것은 그대로 둔다', () => {
    expect(deriveStatus([줄(3, 0)], 'settled')).toBe('settled');
  });
});
