// 두 BOM 맞대기 — 짝은 «품목 + BOX», 구분(도급·사급)은 차이로 보지 않는다 (2026-09-16 대표님)
import { describe, it, expect } from 'vitest';
import { diffBomRows, mapVariantKeys, rowToCopy } from '../../src/domain/bomDiff';

const row = (o) => ({ id: o.id || Math.random().toString(36), qty: 1, ...o });

describe('BOM 맞대기', () => {
  it('한쪽에만 있는 줄을 양방향으로 찾는다', () => {
    const mine = [row({ id: 'a', itemId: 'I1', box: 'MP', name: 'Relay', qty: 4 })];
    const theirs = [row({ id: 'b', itemId: 'I2', box: 'LOCAL', name: '부스바', qty: 1 })];
    const d = diffBomRows(mine, theirs);
    expect(d.map((x) => x.kind).sort()).toEqual(['onlyMine', 'onlyTheirs']);
  });

  it('같은 품목이라도 BOX 가 다르면 다른 줄로 본다', () => {
    const mine = [row({ itemId: 'I1', box: 'MP', qty: 4 })];
    const theirs = [row({ itemId: 'I1', box: 'P/W BOX', qty: 4 })];
    const d = diffBomRows(mine, theirs);
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.kind !== 'qty')).toBe(true);
  });

  it('양쪽에 있고 수량만 다르면 수량 차이 한 줄', () => {
    const mine = [row({ itemId: 'I1', box: 'LOCAL', name: 'FERRITE CORE', qty: 18 })];
    const theirs = [row({ itemId: 'I1', box: 'LOCAL', name: 'FERRITE CORE', qty: 17 })];
    const d = diffBomRows(mine, theirs);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'qty', mineQty: 18, theirQty: 17 });
  });

  it('구분(도급·사급)이 달라도 차이가 아니다 — 회사마다 다른 것이 정상', () => {
    const mine = [row({ itemId: 'I1', box: 'MP', qty: 2, supplyType: 'free' })];
    const theirs = [row({ itemId: 'I1', box: 'MP', qty: 2, supplyType: '' })];
    expect(diffBomRows(mine, theirs)).toEqual([]);
  });

  it('한 BOX 에 같은 품목이 여러 줄이면 합쳐 견준다', () => {
    const mine = [row({ itemId: 'I1', box: 'MP', qty: 2 }), row({ itemId: 'I1', box: 'MP', qty: 3 })];
    const theirs = [row({ itemId: 'I1', box: 'MP', qty: 5 })];
    expect(diffBomRows(mine, theirs)).toEqual([]);
  });

  it('품목번호가 없으면 품명+규격으로 맞춘다', () => {
    const mine = [row({ box: 'MP', name: '부스바', spec: 'WSG-00-405', qty: 1 })];
    const theirs = [row({ box: 'MP', name: '부스바', spec: 'WSG-00-405', qty: 1 })];
    expect(diffBomRows(mine, theirs)).toEqual([]);
  });
});

describe('타입 키 옮기기', () => {
  const from = [
    { key: 'vT5391', label: 'T5391 / MT8311' },
    { key: 'vM7H', label: 'M7H' },
  ];
  const to = [
    { key: 'vmtwa6ghk', label: 'T5391 / MT8311' },
    { key: 'vmtwa6plx', label: 'M7H' },
  ];

  it('라벨이 같은 타입의 키로 바꾼다', () => {
    expect(mapVariantKeys(['vT5391'], from, to)).toEqual(['vmtwa6ghk']);
    expect(mapVariantKeys(['vM7H', 'vT5391'], from, to)).toEqual(['vmtwa6plx', 'vmtwa6ghk']);
  });

  it('상대에 그 라벨이 없으면 떨어뜨린다 — 공통 줄이 된다', () => {
    expect(mapVariantKeys(['vT5391'], from, [{ key: 'x', label: '다른 타입' }])).toEqual([]);
  });

  it('공통(빈 값)은 그대로 공통', () => {
    expect(mapVariantKeys([], from, to)).toEqual([]);
  });
});

describe('복사해 넣을 줄', () => {
  it('구분은 받는 쪽에 같은 품목이 있으면 그 구분을 따른다', () => {
    const src = { itemId: 'I1', name: 'Relay', qty: 4, supplyType: 'free' };
    const toRows = [{ itemId: 'I1', supplyType: '' }];
    expect(rowToCopy(src, { toRows }).supplyType).toBe('');
  });

  it('받는 쪽에 없는 품목이면 도급(빈 값)으로 들어간다', () => {
    const src = { itemId: 'I9', name: '새 품목', qty: 1, supplyType: 'free' };
    expect(rowToCopy(src, { toRows: [] }).supplyType).toBe('');
  });

  it('수량·BOX·도번은 그대로 옮긴다', () => {
    const src = { itemId: 'I1', box: 'MP', qty: 7, drawingNo: '3603-002513', spec: 'X' };
    expect(rowToCopy(src, { toRows: [] })).toMatchObject({ box: 'MP', qty: 7, drawingNo: '3603-002513', spec: 'X' });
  });
});
