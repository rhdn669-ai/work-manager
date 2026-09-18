// 짝 BOM — 한쪽을 고치면 다른 쪽도 (2026-09-18 대표님 「어느 범위까지 연동할지 선택목록을 두고」)
import { describe, it, expect } from 'vitest';
import { rowKey, twinOf, pairPatch, pairCopy, PAIR_DEFAULT } from '../../src/domain/bomPair';

const mine = [
  { key: 'vT5391', label: 'T5391 / MT8311' },
  { key: 'vM7H', label: 'M7H' },
  { key: 'vSmart', label: '스마트' },
];
const theirs = [
  { key: 'vmtwa6ghk', label: 'T5391 / MT8311' },
  { key: 'vmtwa6plx', label: 'M7H' },
];

describe('짝 BOM', () => {
  it('타입 열쇠가 달라도 이름이 같으면 같은 줄로 본다', () => {
    const a = { itemId: 'relay', box: 'LOCAL', variantKeys: ['vM7H'] };
    const b = { itemId: 'relay', box: 'LOCAL', variantKeys: ['vmtwa6plx'] };
    expect(rowKey(a, mine)).toBe(rowKey(b, theirs));
    expect(twinOf(a, mine, [b], theirs)).toBe(b);
  });
  it('BOX 가 다르면 다른 줄이다 — 옮기기 전 열쇠로 짝을 찾아야 한다', () => {
    const a = { itemId: 'relay', box: 'ROBOT', variantKeys: [] };
    const b = { itemId: 'relay', box: 'LOCAL', variantKeys: [] };
    expect(twinOf(a, mine, [b], theirs)).toBeNull();
  });
  it('기본값: 수량·BOX·타입은 가고 구분은 안 간다. 비고·단가는 늘 간다', () => {
    const p = pairPatch(
      { qty: 3, box: 'ROBOT', supplyType: 'free', note: '메모', unitPrice: 100, variantKeys: ['vM7H'] },
      PAIR_DEFAULT,
      mine,
      theirs,
    );
    expect(p).toEqual({ note: '메모', unitPrice: 100, qty: 3, box: 'ROBOT', variantKeys: ['vmtwa6plx'] });
  });
  it('구분을 켜면 같이 가고, 수량을 끄면 안 간다', () => {
    const p = pairPatch({ qty: 3, supplyType: 'free' }, { qty: false, supplyType: true }, mine, theirs);
    expect(p).toEqual({ supplyType: 'free' });
  });
  it('상대에 없는 타입(스마트)은 건너뛴다', () => {
    const p = pairPatch({ variantKeys: ['vSmart', 'vM7H'] }, PAIR_DEFAULT, mine, theirs);
    expect(p.variantKeys).toEqual(['vmtwa6plx']);
  });
  it('옮길 것이 없으면 null — 구분만 고쳤는데 구분은 안 가는 경우', () => {
    expect(pairPatch({ supplyType: 'free' }, PAIR_DEFAULT, mine, theirs)).toBeNull();
  });
  it('새 줄 복사: 구분은 상대 BOM 의 같은 품목을 따른다', () => {
    const c = pairCopy(
      { itemId: 'x', name: 'X', qty: 2, box: 'MP', supplyType: '', variantKeys: ['vM7H'], order: 7 },
      PAIR_DEFAULT,
      mine,
      theirs,
      [{ itemId: 'x', box: 'LOCAL', supplyType: 'free' }],
    );
    expect(c.supplyType).toBe('free');
    expect(c.qty).toBe(2);
    expect(c.box).toBe('MP');
    expect(c.variantKeys).toEqual(['vmtwa6plx']);
    expect(c.order).toBe(7);
  });
});
