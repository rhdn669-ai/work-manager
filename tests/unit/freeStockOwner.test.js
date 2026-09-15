import { describe, it, expect } from 'vitest';
import { takeOrder, returnOrder } from '../../src/domain/freeStockOwner';

describe('사급 재고에서 고객사 것과 우리 것 가르기', () => {
  it('고객사 것부터 나간다 — 우리 것은 건드리지 않는다', () => {
    // 대표님 「고객사거 먼저」
    expect(takeOrder({ qty: 16, ours: 4, want: 10 })).toEqual({ take: 10, fromOurs: 0 });
  });

  it('고객사 것이 모자라면 그만큼만 우리 것에서', () => {
    expect(takeOrder({ qty: 16, ours: 4, want: 14 })).toEqual({ take: 14, fromOurs: 2 });
  });

  it('통에 있는 것보다 많이 꺼내지 않는다', () => {
    expect(takeOrder({ qty: 16, ours: 4, want: 30 })).toEqual({ take: 16, fromOurs: 4 });
  });

  it('전부 우리 것이면 우리 것에서 나간다', () => {
    expect(takeOrder({ qty: 5, ours: 5, want: 3 })).toEqual({ take: 3, fromOurs: 3 });
  });

  it('통이 비면 아무것도 안 나간다', () => {
    expect(takeOrder({ qty: 0, ours: 0, want: 5 })).toEqual({ take: 0, fromOurs: 0 });
  });

  it('되돌릴 때는 우리 몫에서 꺼냈던 만큼을 먼저 우리 몫으로', () => {
    expect(returnOrder({ back: 14, tookOurs: 2 })).toEqual({ back: 14, toOurs: 2 });
    expect(returnOrder({ back: 1, tookOurs: 2 })).toEqual({ back: 1, toOurs: 1 });
    expect(returnOrder({ back: 5, tookOurs: 0 })).toEqual({ back: 5, toOurs: 0 });
  });
});

// 「수정」으로 남음을 줄일 때 우리 몫도 그 이하로 — 셈은 stockService 안에 있어 규칙을 글로 확인한다
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
describe('남음을 손으로 맞출 때 우리 몫이 남음을 넘지 않는다', () => {
  it('stockService.setStockTo 가 ours 를 min(우리 몫, 남음) 으로 자른다', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../../src/services/stockService.js'), 'utf8');
    expect(src).toContain('Math.min(ours === null ? hadOurs : Math.max(0, Number(ours) || 0), t)');
  });
});
