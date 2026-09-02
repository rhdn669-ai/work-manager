// 대분류 차례를 코드로 새기는 계산 (2026-09-02 대표님 「대분류도 드래그 드롭으로
// 순서 바꿀수있게 … 다른 대분류 안에 있는것도 이동 가능하게」).
//
// 여기가 틀리면 수백 품목의 코드가 한꺼번에 잘못 매겨진다. BOM·발주서는 문서 id 로
// 붙들려 있어 연결은 안 끊기지만, 사람이 읽는 번호가 어긋나면 현장에서 물건을 못 찾는다.
import { describe, it, expect } from 'vitest';
import { mainCodeOf, groupLayoutUpdates, moveInLayout, isWorthSaving } from '../../src/domain/itemLayout';

const item = (id, code, groupKey) => ({ id, code, groupKey });

describe('대분류 번호', () => {
  it('보이는 차례가 곧 번호다 — 0 부터 세 자리', () => {
    expect(mainCodeOf(0)).toBe('IOPN-000');
    expect(mainCodeOf(7)).toBe('IOPN-007');
    expect(mainCodeOf(48)).toBe('IOPN-048');
  });
});

describe('배치를 코드로 새기기', () => {
  const items = [
    item('A', 'IOPN-000'),
    item('a1', 'IOPN-000-1', 'A'),
    item('a2', 'IOPN-000-2', 'A'),
    item('B', 'IOPN-001'),
    item('b1', 'IOPN-001-1', 'B'),
  ];
  const layout = [
    { repId: 'A', subIds: ['a1', 'a2'] },
    { repId: 'B', subIds: ['b1'] },
  ];

  it('그대로면 아무것도 바꾸지 않는다', () => {
    expect(groupLayoutUpdates(layout, items)).toEqual([]);
  });

  it('대분류를 맞바꾸면 아래 품목까지 따라 밀린다', () => {
    const swapped = [layout[1], layout[0]];
    const byId = Object.fromEntries(groupLayoutUpdates(swapped, items).map((u) => [u.id, u.patch]));
    expect(byId.B.code).toBe('IOPN-000');
    expect(byId.b1.code).toBe('IOPN-000-1');
    expect(byId.A.code).toBe('IOPN-001');
    expect(byId.a1.code).toBe('IOPN-001-1');
    expect(byId.a2.code).toBe('IOPN-001-2');
  });

  it('다른 대분류로 옮기면 소속도 함께 바뀐다', () => {
    const moved = [
      { repId: 'A', subIds: ['a2'] },
      { repId: 'B', subIds: ['b1', 'a1'] },
    ];
    const byId = Object.fromEntries(groupLayoutUpdates(moved, items).map((u) => [u.id, u.patch]));
    expect(byId.a1).toEqual({ code: 'IOPN-001-2', groupKey: 'B' });
    expect(byId.a2.code).toBe('IOPN-000-1'); // 남은 쪽도 번호를 메운다
  });

  it('아직 저장 안 한 행(tmp-)은 건드리지 않는다', () => {
    const withTmp = [...items, item('tmp-9', '', 'A')];
    const layoutTmp = [{ repId: 'A', subIds: ['a1', 'tmp-9', 'a2'] }, layout[1]];
    const ids = groupLayoutUpdates(layoutTmp, withTmp).map((u) => u.id);
    expect(ids).not.toContain('tmp-9');
  });

  it('번호가 비거나 겹쳐 있어도 차례대로 메운다', () => {
    // IOPN-022 가 비고 IOPN-030 이 둘이던 실제 상태를 옮긴 모양
    const messy = [item('X', 'IOPN-030'), item('Y', 'IOPN-030'), item('Z', 'IOPN-033')];
    const fixed = groupLayoutUpdates(
      [
        { repId: 'X', subIds: [] },
        { repId: 'Y', subIds: [] },
        { repId: 'Z', subIds: [] },
      ],
      messy,
    );
    expect(fixed.map((u) => u.patch.code)).toEqual(['IOPN-000', 'IOPN-001', 'IOPN-002']);
  });
});

describe('끌어다 놓기', () => {
  const layout = [
    { repId: 'A', subIds: ['a1', 'a2', 'a3'] },
    { repId: 'B', subIds: ['b1'] },
  ];
  const keys = ['A', 'B'];

  it('대분류끼리 자리를 바꾼다', () => {
    const next = moveInLayout(layout, 'g:B', 'g:A', keys);
    expect(next.map((g) => g.repId)).toEqual(['B', 'A']);
  });

  it('같은 대분류 안에서 차례를 바꾼다', () => {
    const next = moveInLayout(layout, 'a3', 'a1', keys);
    expect(next[0].subIds).toEqual(['a3', 'a1', 'a2']);
  });

  it('아래로 옮길 때 자리가 한 칸 밀리지 않는다', () => {
    // 빼고 넣는 순서 때문에 흔히 틀리는 곳이다
    const next = moveInLayout(layout, 'a1', 'a3', keys);
    expect(next[0].subIds).toEqual(['a2', 'a3', 'a1']);
  });

  it('다른 대분류의 품목 자리로 옮긴다', () => {
    const next = moveInLayout(layout, 'a2', 'b1', keys);
    expect(next[0].subIds).toEqual(['a1', 'a3']);
    expect(next[1].subIds).toEqual(['a2', 'b1']);
  });

  it('접힌 대분류 카드 위에 떨구면 맨 끝으로 들어간다', () => {
    const next = moveInLayout(layout, 'a2', 'g:B', keys);
    expect(next[1].subIds).toEqual(['b1', 'a2']);
  });

  it('제자리면 아무 일도 없다', () => {
    expect(moveInLayout(layout, 'a1', 'a1', keys)).toBeNull();
    expect(moveInLayout(layout, 'g:A', 'g:A', keys)).toBeNull();
  });

  it('대분류를 품목 위에 떨구는 것은 받지 않는다', () => {
    expect(moveInLayout(layout, 'g:A', 'b1', keys)).toBeNull();
  });

  it('원래 배치를 망가뜨리지 않는다', () => {
    moveInLayout(layout, 'a2', 'b1', keys);
    expect(layout[0].subIds).toEqual(['a1', 'a2', 'a3']);
    expect(layout[1].subIds).toEqual(['b1']);
  });
});

describe('새 줄을 언제 저장하는가', () => {
  const base = { id: 'tmp-1', code: 'IOPN-050' };

  it('품명이 없어도 규격만 적었으면 저장한다 — 여기서 사라졌다', () => {
    expect(isWorthSaving({ ...base, spec: 'GCP-32ANM 5A 2P' })).toBe(true);
  });

  it('도번만 적었어도 저장한다', () => {
    expect(isWorthSaving({ ...base, drawingNo: '3501-001593' })).toBe(true);
  });

  it('단가만 넣었어도 저장한다', () => {
    expect(isWorthSaving({ ...base, standardPrice: 12000 })).toBe(true);
    expect(isWorthSaving({ ...base, unitPrice: 500 })).toBe(true);
  });

  it('구매처만 골랐어도 저장한다', () => {
    expect(isWorthSaving({ ...base, defaultSupplierId: 'sup-1' })).toBe(true);
  });

  it('품명이 있으면 당연히 저장한다', () => {
    expect(isWorthSaving({ ...base, name: 'CP' })).toBe(true);
  });

  it('코드만 있는 빈 줄은 보내지 않는다 — 「추가」만 누르고 둔 줄', () => {
    expect(isWorthSaving(base)).toBe(false);
    expect(isWorthSaving({ ...base, name: '   ', spec: '' })).toBe(false);
    expect(isWorthSaving({ ...base, standardPrice: 0, unitPrice: 0 })).toBe(false);
  });

  it('없는 값에도 흔들리지 않는다', () => {
    expect(isWorthSaving(null)).toBe(false);
    expect(isWorthSaving({})).toBe(false);
  });
});
