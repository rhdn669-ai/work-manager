// 사급 기록을 고객사 칸 / 당사 칸으로 가르기 (2026-09-16 대표님 「공유x」)
import { describe, it, expect } from 'vitest';
import { sideShare, logsForSide, fixSideOf } from '../../src/domain/stockSide';

describe('칸 몫', () => {
  it('당사 것으로 들어온 줄은 당사 칸에만 온전히 뜬다', () => {
    const l = { kind: 'in', n: 7, ours: true };
    expect(sideShare(l, 'ours').n).toBe(7);
    expect(sideShare(l, 'theirs').n).toBe(0);
  });

  it('ours 가 없는 옛 입고는 고객사 것으로 본다 — 사급 본래 몫', () => {
    const l = { kind: 'in', n: 4 };
    expect(sideShare(l, 'theirs').n).toBe(4);
    expect(sideShare(l, 'ours').n).toBe(0);
  });

  it('두 칸에 걸쳐 나간 줄은 칸마다 제 몫만', () => {
    const l = { kind: 'out', n: 5, fromOurs: 2 };
    expect(sideShare(l, 'ours').n).toBe(2);
    expect(sideShare(l, 'theirs').n).toBe(3);
  });

  it('되돌림도 걸친 만큼 갈라 센다', () => {
    const l = { kind: 'back', n: 5, toOurs: 2 };
    expect(sideShare(l, 'ours').n).toBe(2);
    expect(sideShare(l, 'theirs').n).toBe(3);
  });

  it('발주 입고는 당사 몫을 안 건드리므로 고객사 칸', () => {
    const l = { kind: 'po-in', n: 9, applied: true };
    expect(sideShare(l, 'theirs').n).toBe(9);
    expect(sideShare(l, 'ours').n).toBe(0);
  });

  it('칸이 적힌 손맞춤은 그 칸에만', () => {
    const l = { kind: 'fix', from: 3, n: 5, side: 'ours' };
    expect(sideShare(l, 'ours')).toMatchObject({ n: 5, whole: true });
    expect(sideShare(l, 'theirs').skip).toBe(true);
  });

  it('칸이 없는 옛 손맞춤은 «몫을 못 가른다»고 알린다', () => {
    expect(sideShare({ kind: 'fix', from: 3, n: 5 }, 'ours').whole).toBe(false);
  });

  it('칸을 안 주면(도급) 줄 전체가 그대로', () => {
    expect(sideShare({ kind: 'out', n: 5, fromOurs: 2 }).n).toBe(5);
  });
});

describe('칸별 목록', () => {
  const logs = [
    { at: '5', kind: 'in', n: 7, ours: true },
    { at: '4', kind: 'out', n: 5, fromOurs: 2 },
    { at: '3', kind: 'in', n: 4 },
    { at: '2', kind: 'fix', from: 1, n: 2, side: 'theirs' },
    { at: '1', kind: 'fix', from: 0, n: 1 },
  ];

  it('당사 칸에는 당사가 얽힌 줄만 — 남의 칸 입고는 안 뜬다', () => {
    expect(logsForSide(logs, 'ours').map((l) => l.at)).toEqual(['5', '4', '1']);
  });

  it('고객사 칸에도 제 줄만', () => {
    expect(logsForSide(logs, 'theirs').map((l) => l.at)).toEqual(['4', '3', '2', '1']);
  });

  it('칸 모르는 옛 손맞춤은 양쪽에 다 남는다', () => {
    expect(logsForSide(logs, 'ours').some((l) => l.at === '1')).toBe(true);
    expect(logsForSide(logs, 'theirs').some((l) => l.at === '1')).toBe(true);
  });

  it('칸을 안 주면 전부 그대로', () => {
    expect(logsForSide(logs).length).toBe(5);
  });
});

describe('옛 손맞춤의 칸 — 앱이 박아 둔 비고로 찾기', () => {
  it('「고객사 실물 세어 맞춤」은 고객사 칸', () => {
    const l = { kind: 'fix', from: 4, n: 0, note: '고객사 실물 세어 맞춤' };
    expect(fixSideOf(l)).toBe('theirs');
    expect(sideShare(l, 'ours').skip).toBe(true);
    expect(sideShare(l, 'theirs')).toMatchObject({ n: 0, whole: true });
  });

  it('「당사」·옛 문구 「우리 것」 둘 다 당사 칸', () => {
    expect(fixSideOf({ kind: 'fix', note: '당사 실물 세어 맞춤' })).toBe('ours');
    expect(fixSideOf({ kind: 'fix', note: '우리 것 실물 세어 맞춤' })).toBe('ours');
  });

  it('적힌 side 가 비고보다 앞선다', () => {
    expect(fixSideOf({ kind: 'fix', side: 'ours', note: '고객사 실물 세어 맞춤' })).toBe('ours');
  });

  it('짐작할 글귀가 없으면 끝내 모른다 — 꾸며 내지 않는다', () => {
    expect(fixSideOf({ kind: 'fix', note: '' })).toBe(null);
    expect(fixSideOf({ kind: 'fix', note: '재고 정리' })).toBe(null);
  });
});
