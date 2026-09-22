// 짝 BOM — 한쪽을 고치면 다른 쪽도 (2026-09-18 대표님 「어느 범위까지 연동할지 선택목록을 두고」)
import { describe, it, expect } from 'vitest';
import {
  rowKey,
  rowKeysOf,
  twinOf,
  pairPatch,
  pairCopy,
  dirStateForPair,
  PAIR_DEFAULT,
} from '../../src/domain/bomPair';

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

// 같은 품목이 한 BOX 에 여러 줄이면 열쇠가 겹쳐 앞의 하나만 짝이 잡혔다
// (2026-09-22 대표님 「메티스 디에이치 BOM 수량이왜또 다르냐」 → 「A ㄱㄱ」)
describe('같은 열쇠가 여럿일 때 — 몇 번째로 가른다', () => {
  const mine = [
    { id: 'm1', itemId: 'lan', box: '준비작업', order: 1 },
    { id: 'm2', itemId: 'lan', box: '준비작업', order: 2 },
  ];
  const theirs = [
    { id: 'd1', itemId: 'lan', box: '준비작업', order: 1 },
    { id: 'd2', itemId: 'lan', box: '준비작업', order: 2 },
  ];
  it('첫 줄은 순번을 안 붙인다 — 상대에 하나뿐이면 예전처럼 짝이 된다', () => {
    const k = rowKeysOf([mine[0]], []);
    expect(k.get('m1')).toBe(rowKey(mine[0], []));
  });
  it('둘째 줄부터 #2 가 붙는다', () => {
    const k = rowKeysOf(mine, []);
    expect(k.get('m2')).toBe(`${rowKey(mine[1], [])}#2`);
  });
  it('첫째는 첫째끼리, 둘째는 둘째끼리 짝이 된다', () => {
    expect(twinOf(mine[0], [], theirs, [], mine)?.id).toBe('d1');
    expect(twinOf(mine[1], [], theirs, [], mine)?.id).toBe('d2');
  });
  it('줄 순서(order)를 따른다 — 배열에 담긴 차례가 아니라', () => {
    const shuffled = [mine[1], mine[0]];
    expect(twinOf(mine[1], [], theirs, [], shuffled)?.id).toBe('d2');
  });
  it('myRows 를 안 주면 옛 동작 — 첫 줄만 찾는다', () => {
    expect(twinOf(mine[1], [], theirs, [])?.id).toBe('d1');
  });
  it('상대에 줄이 하나뿐이면 둘째 줄은 짝이 없다 — 엉뚱한 줄에 덮어쓰지 않는다', () => {
    expect(twinOf(mine[1], [], [theirs[0]], [], mine)).toBeNull();
  });
});

// 방향 한 칸에 «설계 사실(없음)»과 «업무 범위(안셈)»가 섞여 있었다. 통째로 연동하니
// 디에이치는 정방향도 전부 우리 자재인데 메티스의 「안셈」이 끌려가 60자리가 틀어졌다
// (2026-09-22 대표님 「정역 구성은 같지만 … 구분은 서로 연동이 안되게 끊었는데」)
describe('방향 — 「없음」만 짝에 옮긴다', () => {
  it('「없음」은 상대에도 간다 — 구성은 같다', () => {
    expect(dirStateForPair({ 정: 'none', 역: 'use' }, { 정: 'use', 역: 'use' })).toEqual({ 정: 'none', 역: 'use' });
  });
  it('「안셈」은 안 간다 — 상대가 「셈」이면 「셈」 그대로', () => {
    expect(dirStateForPair({ 정: 'gray', 역: 'use' }, { 정: 'use', 역: 'use' })).toEqual({ 정: 'use', 역: 'use' });
  });
  it('상대가 「안셈」이면 그대로 둔다 — 내가 「셈」이어도 안 건드린다', () => {
    expect(dirStateForPair({ 정: 'use', 역: 'use' }, { 정: 'gray', 역: 'use' })).toEqual({ 정: 'gray', 역: 'use' });
  });
  it('내가 「없음」을 풀면 상대도 푼다 — 「셈」으로', () => {
    expect(dirStateForPair({ 정: 'gray', 역: 'use' }, { 정: 'none', 역: 'use' })).toEqual({ 정: 'use', 역: 'use' });
  });
  it('pairPatch — 「안셈」만 바꾸면 방향은 안 넘어간다', () => {
    const twin = { dirState: { 정: 'use', 역: 'use' } };
    const p = pairPatch({ dirState: { 정: 'gray', 역: 'use' } }, PAIR_DEFAULT, mine, theirs, twin);
    expect(p?.dirState).toBeUndefined();
  });
  it('pairPatch — 「없음」으로 바꾸면 방향이 넘어간다', () => {
    const twin = { dirState: { 정: 'use', 역: 'use' } };
    const p = pairPatch({ dirState: { 정: 'none', 역: 'use' } }, PAIR_DEFAULT, mine, theirs, twin);
    expect(p.dirState).toEqual({ 정: 'none', 역: 'use' });
  });
  it('새 줄 복사 — 「없음」만 따라가고 「안셈」은 「셈」으로 시작한다', () => {
    const c = pairCopy({ itemId: 'x', dirState: { 정: 'gray', 역: 'none' } }, PAIR_DEFAULT, mine, theirs, []);
    expect(c.dirState).toEqual({ 정: 'use', 역: 'none' });
  });
});
