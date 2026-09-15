import { describe, it, expect } from 'vitest';
import { outTally, tallyOut, outSetsOf, outSetsLabel } from '../../src/domain/outSets';

describe('재고 「나감」 — 세트 수는 시작한 호기 수, 줄마다 부족 대수', () => {
  it('9대가 시작했고 5대만 다 채웠으면 「9 SET · 부족 4」', () => {
    const t = outTally();
    const started = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) tallyOut(t, 'A', id, 16, 16);
    tallyOut(t, 'A', 'p6', 0, 16); // 안 넣음 — 부족
    expect(outSetsOf(t, 'A', started)).toEqual({ sets: 9, full: 5, short: 4 });
    expect(outSetsLabel(outSetsOf(t, 'A', started))).toBe('9 SET · 부족 4');
  });

  it('덜 넣은 호기도 부족 (대표님 「일부로 표시하지말고 부족 n 으로」)', () => {
    const t = outTally();
    const started = new Set(['p1', 'p2']);
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p2', 1, 2);
    expect(outSetsLabel(outSetsOf(t, 'A', started))).toBe('2 SET · 부족 1');
  });

  it('「제외」로 꺼 둔 호기는 세트에서도 뺀다', () => {
    const t = outTally();
    const started = new Set(['p1', 'p2', 'p3']);
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p2', 0, 2, true); // 이 호기에선 필요 없음
    expect(outSetsOf(t, 'A', started)).toEqual({ sets: 2, full: 1, short: 1 });
  });

  it('다 채웠으면 부족을 안 붙인다', () => {
    const t = outTally();
    const started = new Set(['p1']);
    tallyOut(t, 'A', 'p1', 1, 1);
    expect(outSetsLabel(outSetsOf(t, 'A', started))).toBe('1 SET');
  });

  it('시작한 호기를 안 주면 이 줄에 넣은 호기만으로', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p2', 1, 2);
    expect(outSetsOf(t, 'A')).toEqual({ sets: 2, full: 1, short: 1 });
    expect(outSetsOf(t, 'B')).toEqual({ sets: 0, full: 0, short: 0 });
  });

  it('같은 품목 다른 줄에서 덜 채운 호기는 다 채운 것으로 안 센다', () => {
    const t = outTally();
    tallyOut(t, 'A', 'p1', 2, 2);
    tallyOut(t, 'A', 'p1', 1, 3);
    expect(outSetsOf(t, 'A')).toEqual({ sets: 1, full: 0, short: 1 });
  });
});
