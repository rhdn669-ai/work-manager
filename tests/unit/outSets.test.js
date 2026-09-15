import { describe, it, expect } from 'vitest';
import { outTally, tallyOut, outSetsOf, outSetsLabel } from '../../src/domain/outSets';

describe('재고 「나감」 — 줄마다 다 채운 호기 SET · 덜 채운 호기 일부', () => {
  it('다 채운 호기만 SET 로 센다', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p2', 2, 2);
    tallyOut(t, 'A', 'p3', 1, 2); // 덜 넣음
    tallyOut(t, 'A', 'p4', 0, 2); // 안 넣음 — 안 센다
    expect(outSetsOf(t, 'A')).toEqual({ full: 2, part: 1 });
    expect(outSetsLabel(outSetsOf(t, 'A'))).toBe('2 SET · 1대 일부');
  });

  it('안 나간 품목은 0 SET (대표님 「안나간 품목은 set 표시를 안올려야」)', () => {
    const t = outTally();
    expect(outSetsOf(t, 'B')).toEqual({ full: 0, part: 0 });
    expect(outSetsLabel(outSetsOf(t, 'B'))).toBe('0 SET');
  });

  it('같은 품목 다른 줄에서 덜 채운 호기는 「일부」로만 센다', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 2, 2); // 줄 1 다 채움
    tallyOut(t, 'A', 'p1', 1, 3); // 줄 2 덜 채움
    expect(outSetsOf(t, 'A')).toEqual({ full: 0, part: 1 });
  });

  it('필요 수량이 0 인 줄에 넣었으면 다 채운 것으로', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 1, 0);
    expect(outSetsOf(t, 'A')).toEqual({ full: 1, part: 0 });
  });
});
