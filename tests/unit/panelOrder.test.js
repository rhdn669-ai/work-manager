// 생산현황 행 순서 — 끌어 옮기기와 납기 어긋남 표시 (2026-09-03 대표님).
import { describe, it, expect } from 'vitest';
import { misorderedIds, mergeMove, orderOf } from '../../src/domain/panelOrder';

const p = (id, 납기, order) => ({ id, 납기, order });

describe('납기 순서와 어긋난 줄', () => {
  it('납기순 그대로면 아무것도 표시하지 않는다', () => {
    expect(misorderedIds([p('a', '2026-09-01'), p('b', '2026-09-05'), p('c', '2026-09-09')]).size).toBe(0);
  });
  it('두 줄을 맞바꾸면 둘 다 표시된다', () => {
    const s = misorderedIds([p('a', '2026-09-05'), p('b', '2026-09-01'), p('c', '2026-09-09')]);
    expect([...s].sort()).toEqual(['a', 'b']);
  });
  it('납기가 빈 줄은 판정에서 빠지고 남들도 방해하지 않는다', () => {
    const s = misorderedIds([p('a', '2026-09-01'), p('x', ''), p('b', '2026-09-05')]);
    expect(s.size).toBe(0);
  });
  it('같은 날짜끼리는 어느 순서든 괜찮다', () => {
    expect(misorderedIds([p('a', '2026-09-01'), p('b', '2026-09-01')]).size).toBe(0);
  });
});

describe('보이는 줄 안에서 옮긴 것을 전체 목록에 끼워 넣기', () => {
  const full = ['a', 'b', 'c', 'd', 'e'];
  it('아래로 옮기면 over 뒤에 놓인다', () => {
    expect(mergeMove(full, full, 'a', 'c')).toEqual(['b', 'c', 'a', 'd', 'e']);
  });
  it('위로 옮기면 over 앞에 놓인다', () => {
    expect(mergeMove(full, full, 'd', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
  it('검색으로 일부만 보일 때 — 숨은 줄은 제자리, 옮긴 줄은 보이는 앞줄 바로 뒤로', () => {
    // 보이는 것: a, c, e (b·d 숨김). e 를 a 와 c 사이로
    expect(mergeMove(full, ['a', 'c', 'e'], 'e', 'c')).toEqual(['a', 'b', 'e', 'c', 'd']);
  });
  it('맨 앞으로 옮기면 그 줄 앞 숨은 줄보다도 앞이 된다', () => {
    expect(mergeMove(full, ['b', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
  it('같은 자리면 그대로', () => {
    expect(mergeMove(full, full, 'b', 'b')).toEqual(full);
  });
});

describe('순서값', () => {
  it('없으면 맨 뒤', () => {
    expect(orderOf({ order: 3 })).toBe(3);
    expect(orderOf({})).toBe(Number.MAX_SAFE_INTEGER);
    expect(orderOf(null)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
