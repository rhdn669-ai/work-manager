// 타입별 수량 — 「기본 + 다른 타입만 예외」 (2026-09-21 대표님 「타입별로 수량을 다르게 적을수있게」)
import { describe, it, expect } from 'vitest';
import { qtyForVariant, rowInVariant, rowsForVariant, variantQtyList } from '../../src/domain/panelBom';
import { mapVariantQty } from '../../src/domain/bomPair';

const mine = [
  { key: 'vT5391', label: 'T5391 / MT8311' },
  { key: 'vM7H', label: 'M7H' },
  { key: 'vSmart', label: '스마트' },
];
const theirs = [
  { key: 'vg', label: 'T5391 / MT8311' },
  { key: 'vp', label: 'M7H' },
];

describe('새 모양 — 기본 수량 + 타입별 예외', () => {
  const lan = { id: 'lan', qty: 8, qtyByVariant: { vM7H: 7 } };
  it('예외가 있는 타입은 그 값, 없으면 기본', () => {
    expect(qtyForVariant(lan, 'vM7H')).toBe(7);
    expect(qtyForVariant(lan, 'vT5391')).toBe(8);
    expect(qtyForVariant(lan, '')).toBe(8); // 타입 안 정한 호기는 기본
  });
  it('예외 0 이면 그 타입에는 없는 줄', () => {
    const only = { id: 'x', qty: 2, qtyByVariant: { vM7H: 0 } };
    expect(qtyForVariant(only, 'vM7H')).toBe(0);
    expect(rowInVariant(only, 'vM7H')).toBe(false);
    expect(rowInVariant(only, 'vT5391')).toBe(true);
  });
  it('기본을 비우면 타입을 안 정한 호기에는 안 뜬다 (대표님 「기본값을 비우고」)', () => {
    const split = { id: 's', qty: 0, qtyByVariant: { vT5391: 8, vM7H: 7 } };
    expect(qtyForVariant(split, '')).toBe(0);
    expect(rowInVariant(split, '')).toBe(false);
    expect(qtyForVariant(split, 'vT5391')).toBe(8);
    expect(rowInVariant(split, 'vM7H')).toBe(true);
  });
  it('기본과 다른 값만 «예외»로 보여 준다', () => {
    expect(variantQtyList(lan)).toEqual([{ key: 'vM7H', qty: 7 }]);
    expect(variantQtyList({ qty: 8, qtyByVariant: { vM7H: 8 } })).toEqual([]);
    expect(variantQtyList({ qty: 8 })).toEqual([]);
  });
});

describe('옛 모양 — 타입 전용 줄도 같은 함수로 읽는다 (자료 안 옮겨도 그대로)', () => {
  const common = { id: 'c', qty: 2, variantKeys: [] };
  const onlyM7H = { id: 'm', qty: 1, variantKeys: ['vM7H'] };
  it('타입 전용 줄은 그 타입에서만 수량이 있다', () => {
    expect(qtyForVariant(onlyM7H, 'vM7H')).toBe(1);
    expect(qtyForVariant(onlyM7H, 'vT5391')).toBe(0);
    expect(rowInVariant(onlyM7H, 'vT5391')).toBe(false);
  });
  it('타입을 안 정한 호기는 전처럼 전용 줄도 본다', () => {
    expect(rowInVariant(onlyM7H, '')).toBe(true);
    expect(qtyForVariant(onlyM7H, '')).toBe(1);
  });
  it('공통 줄은 어느 타입에서나', () => {
    expect(qtyForVariant(common, 'vM7H')).toBe(2);
    expect(rowInVariant(common, 'vSmart')).toBe(true);
  });
});

describe('타입에 맞는 줄 — 수량까지 바꿔서 준다', () => {
  const rows = [
    { id: 'lan', qty: 8, qtyByVariant: { vM7H: 7 } },
    { id: 'relay', qty: 2 },
    { id: 'mpOnly', qty: 0, qtyByVariant: { vM7H: 1 } },
    { id: 'old', qty: 1, variantKeys: ['vT5391'] },
  ];
  it('M7H 호기', () => {
    expect(rowsForVariant(rows, 'vM7H').map((r) => [r.id, r.qty])).toEqual([
      ['lan', 7],
      ['relay', 2],
      ['mpOnly', 1],
    ]);
  });
  it('T5391 호기', () => {
    expect(rowsForVariant(rows, 'vT5391').map((r) => [r.id, r.qty])).toEqual([
      ['lan', 8],
      ['relay', 2],
      ['old', 1],
    ]);
  });
  it('원본 줄은 건드리지 않는다', () => {
    rowsForVariant(rows, 'vM7H');
    expect(rows[0].qty).toBe(8);
  });
});

describe('짝 BOM — 타입별 수량은 이름으로 짝지어 옮긴다', () => {
  it('상대에 있는 타입만 옮기고 없는 타입(스마트)은 버린다', () => {
    expect(mapVariantQty({ vM7H: 7, vSmart: 3 }, mine, theirs)).toEqual({ vp: 7 });
  });
  it('값이 없으면 빈 객체', () => {
    expect(mapVariantQty(undefined, mine, theirs)).toEqual({});
  });
});
