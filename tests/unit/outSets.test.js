import { describe, it, expect } from 'vitest';
import { outTally, tallyOut, outSetsOf, outSetsLabel } from '../../src/domain/outSets';

describe('재고 「나감」 — 도급·판금은 세트 기준, 사급은 체크 기준', () => {
  const nine = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);

  it('도급: 9대가 시작했고 5대만 다 채웠으면 「9 SET · 부족 4」', () => {
    const t = outTally();
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) tallyOut(t, 'A', id, 16, 16);
    expect(outSetsOf(t, 'A', nine)).toEqual({ sets: 9, full: 5, short: 4, shortUnit: '대' });
    expect(outSetsLabel(outSetsOf(t, 'A', nine))).toBe('9 SET · 부족 4');
  });

  it('도급: 「제외」로 꺼 둔 호기는 부족에서 뺀다 — 세트 수는 그대로 9 (대표님 「나감 9로 맞춰주고」)', () => {
    const t = outTally();
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) tallyOut(t, 'A', id, 16, 16);
    for (const id of ['p6', 'p7', 'p8', 'p9']) tallyOut(t, 'A', id, 0, 16, true);
    expect(outSetsOf(t, 'A', nine)).toEqual({ sets: 9, full: 5, short: 0, shortUnit: '대' });
    expect(outSetsLabel(outSetsOf(t, 'A', nine))).toBe('9 SET');
  });

  it('도급: 덜 넣은 호기도 부족', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p2', 1, 2);
    expect(outSetsLabel(outSetsOf(t, 'A', new Set(['p1', 'p2'])))).toBe('2 SET · 부족 1');
  });

  it('사급: 이 줄에 실제로 넣은 호기만 세고, 부족은 개수로 (대표님 「부족은 댓수 말고 수량으로」)', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 4, 4);
    tallyOut(t, 'A', 'p2', 4, 4);
    tallyOut(t, 'A', 'p3', 1, 4); // 3개 덜 넣음
    tallyOut(t, 'A', 'p4', 0, 4); // 안 넣음 — 안 센다
    expect(outSetsOf(t, 'A')).toEqual({ sets: 3, full: 2, short: 3, shortUnit: '개' });
    expect(outSetsLabel(outSetsOf(t, 'A'))).toBe('3 SET · 부족 3');
    expect(outSetsLabel(outSetsOf(t, 'B'))).toBe('0 SET');
  });

  it('같은 품목 다른 줄에서 덜 채운 호기는 다 채운 것으로 안 센다', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p1', 1, 3);
    expect(outSetsOf(t, 'A')).toEqual({ sets: 1, full: 0, short: 2, shortUnit: '개' });
    expect(outSetsOf(t, 'A', new Set(['p1']))).toEqual({ sets: 1, full: 0, short: 1, shortUnit: '대' });
  });
});
