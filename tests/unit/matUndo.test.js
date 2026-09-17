// 줄을 처음 상태로 되돌릴 때의 배분 (2026-09-17 대표님 「취소 … 처음 대기상태로」)
import { describe, it, expect } from 'vitest';
import { undoPlan } from '../../src/domain/matUndo';

describe('되돌림 계획', () => {
  it('통에서만 채운 줄 — 전부 통으로', () => {
    const p = undoPlan({ qty: 3, fromStock: 3, fromOurs: 1, log: [{ id: 'a', kind: 'in', why: '구매', n: 3 }] });
    expect(p.toStock).toBe(3);
    expect(p.tookOurs).toBe(1);
    expect(p.toMates).toEqual([]);
    expect(p.logs.length).toBe(1);
  });

  it('다른 호기에서 가져온 몫은 그 호기로, 통에서 온 표시도 따라간다', () => {
    const p = undoPlan({
      qty: 3,
      fromStock: 3,
      log: [{ id: 'a', kind: 'in', why: '가져옴', n: 2, mate: 'p289' }],
    });
    expect(p.toMates).toEqual([{ mate: 'p289', n: 2, fromStock: 2 }]);
    expect(p.toStock).toBe(1); // 나머지 1 만 통으로
    expect(p.tookFromMates).toBe(2);
  });

  it('통에서 온 몫이 없으면 호기로만 돌아가고 통엔 안 간다', () => {
    const p = undoPlan({ qty: 2, fromStock: 0, log: [{ id: 'a', kind: 'in', why: '가져옴', n: 2, mate: 'p289' }] });
    expect(p.toMates[0].fromStock).toBe(0);
    expect(p.toStock).toBe(0);
  });

  it('이 줄에서 남에게 보낸 것은 되돌리지 않고 알려만 준다', () => {
    const p = undoPlan({ qty: 1, fromStock: 1, log: [{ id: 'a', kind: 'out', why: '가져감', n: 1, mate: 'p465' }] });
    expect(p.kept).toEqual([{ mate: 'p465', n: 1 }]);
    expect(p.toMates).toEqual([]);
  });

  it('옛 낱말 「차용」도 가져옴으로 읽는다', () => {
    const p = undoPlan({ qty: 1, fromStock: 1, log: [{ id: 'a', kind: 'in', why: '차용', n: 1, mate: 'p209' }] });
    expect(p.toMates[0].mate).toBe('p209');
  });

  it('통에서 온 몫이 수량보다 크게 적혀 있어도 수량을 넘겨 돌려주지 않는다', () => {
    const p = undoPlan({ qty: 2, fromStock: 9, log: [] });
    expect(p.toStock).toBe(2);
  });

  it('빈 줄은 아무것도 안 움직인다', () => {
    const p = undoPlan({});
    expect(p).toMatchObject({ qty: 0, toStock: 0, tookOurs: 0, toMates: [], kept: [], logs: [] });
  });
});
