// 통 기록의 「뒤 수량」 — 지금 수량에서 거꾸로 되짚는다 (2026-09-16 대표님)
import { describe, it, expect } from 'vitest';
import { withRunning, deltaOf } from '../../src/domain/stockRunning';

// 최신순(위가 가장 최근)
const logs = [
  { at: '2026-09-16T21:27', kind: 'in', n: 2 },
  { at: '2026-09-16T20:10', kind: 'out', n: 2 },
  { at: '2026-09-16T20:09', kind: 'out', n: 2 },
  { at: '2026-09-15T15:07', kind: 'in', n: 14 },
];

describe('뒤 수량', () => {
  it('맨 윗줄은 지금 통 수량과 같다', () => {
    expect(withRunning(logs, 12)[0].after).toBe(12);
  });

  it('아래로 내려가며 그 줄이 한 일을 되돌린다', () => {
    expect(withRunning(logs, 12).map((l) => l.after)).toEqual([12, 10, 12, 14]);
  });

  it('맨 아랫줄의 뒤 수량은 그 줄이 만든 값이다 — 처음 14개가 들어왔다', () => {
    const r = withRunning(logs, 12);
    expect(r[r.length - 1].after).toBe(14);
  });

  it('「손으로 맞춤」은 그 앞을 from 으로 이어 간다', () => {
    const l = [
      { at: '3', kind: 'out', n: 1 },
      { at: '2', kind: 'fix', from: 9, n: 5 },
      { at: '1', kind: 'in', n: 9 },
    ];
    // 지금 4 → out 1 되돌리면 맞춤 직후 5, 그 앞은 from 9
    expect(withRunning(l, 4).map((x) => x.after)).toEqual([4, 5, 9]);
  });

  it('발주 입고는 반영된 것만 수량을 움직인다', () => {
    expect(deltaOf({ kind: 'po-in', n: 7, applied: true })).toBe(7);
    expect(deltaOf({ kind: 'po-in', n: 7, applied: false })).toBe(0);
  });

  it('되돌림은 들어온 것과 같게 센다', () => {
    expect(deltaOf({ kind: 'back', n: 3 })).toBe(3);
    expect(deltaOf({ kind: 'out', n: 3 })).toBe(-3);
  });

  it('기록이 없으면 빈 배열', () => {
    expect(withRunning([], 5)).toEqual([]);
    expect(withRunning(null, 5)).toEqual([]);
  });

  it('0 밑으로는 안 내려간다 — 앱 밖에서 고친 값이 섞였을 때', () => {
    const l = [{ at: '1', kind: 'out', n: 99 }];
    expect(withRunning(l, 0)[0].after).toBe(0);
  });
});

describe('칸별 뒤 수량 — 사급', () => {
  // 최신순. 당사 칸은 지금 5
  const logs = [
    { at: '4', kind: 'out', n: 5, fromOurs: 2 }, // 당사 −2 · 고객사 −3
    { at: '3', kind: 'in', n: 7, ours: true }, // 당사 +7
    { at: '2', kind: 'in', n: 4 }, // 고객사 +4
  ];

  it('당사 칸은 당사 몫으로만 되짚는다', () => {
    expect(withRunning(logs, 5, 'ours').map((l) => l.after)).toEqual([5, 7, 0]);
  });

  it('고객사 칸은 고객사 몫으로만', () => {
    expect(withRunning(logs, 1, 'theirs').map((l) => l.after)).toEqual([1, 4, 4]);
  });

  it('줄마다 그 칸 몫을 같이 돌려준다 — 5 나간 줄이 당사 칸에선 2', () => {
    expect(withRunning(logs, 5, 'ours')[0].share).toBe(2);
    expect(withRunning(logs, 1, 'theirs')[0].share).toBe(3);
  });

  it('칸 모르는 옛 손맞춤 밑으로는 뒤 수량을 비운다 — 꾸며 내지 않는다', () => {
    const l = [
      { at: '3', kind: 'in', n: 2, ours: true },
      { at: '2', kind: 'fix', from: 9, n: 5 },
      { at: '1', kind: 'in', n: 9, ours: true },
    ];
    expect(withRunning(l, 7, 'ours').map((x) => x.after)).toEqual([7, 5, null]);
  });

  it('칸이 적힌 손맞춤은 그대로 이어 간다', () => {
    const l = [
      { at: '2', kind: 'fix', from: 3, n: 6, side: 'ours' },
      { at: '1', kind: 'in', n: 3, ours: true },
    ];
    expect(withRunning(l, 6, 'ours').map((x) => x.after)).toEqual([6, 3]);
  });
});
