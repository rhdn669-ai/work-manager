// 여러 줄 한 번에 옮기기 (2026-09-04 대표님).
import { describe, it, expect } from 'vitest';
import { moveMany, applyVisibleOrder } from '../../src/domain/moveMany';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('여러 줄 옮기기', () => {
  it('체크한 줄 중 하나를 아래로 끌면 체크한 줄 전부가 차례를 지킨 채 그 뒤로 간다', () => {
    expect(moveMany(ids, ['a', 'c'], 'a', 'e')).toEqual(['b', 'd', 'e', 'a', 'c', 'f']);
  });
  it('위로 끌면 놓은 줄 앞으로', () => {
    expect(moveMany(ids, ['d', 'f'], 'f', 'b')).toEqual(['a', 'd', 'f', 'b', 'c', 'e']);
  });
  it('체크 안 한 줄을 끌면 그 줄만 움직인다', () => {
    expect(moveMany(ids, ['a', 'c'], 'e', 'b')).toEqual(['a', 'e', 'b', 'c', 'd', 'f']);
  });
  it('체크가 하나뿐이면 보통 이동과 같다', () => {
    expect(moveMany(ids, ['b'], 'b', 'd')).toEqual(['a', 'c', 'd', 'b', 'e', 'f']);
  });
  it('묶음 안의 줄 위에 놓으면 그대로', () => {
    expect(moveMany(ids, ['a', 'c'], 'a', 'c')).toEqual(ids);
  });
  it('같은 자리·없는 id 는 그대로', () => {
    expect(moveMany(ids, [], 'a', 'a')).toEqual(ids);
    expect(moveMany(ids, [], 'zz', 'a')).toEqual(ids);
  });
});

describe('보이는 줄 차례를 전체에 끼워 넣기', () => {
  it('숨은 줄은 제자리, 보이던 자리에 새 차례를 채운다', () => {
    const full = ['a', 'b', 'c', 'd', 'e'];
    expect(applyVisibleOrder(full, ['a', 'c', 'e'], ['e', 'a', 'c'])).toEqual(['e', 'b', 'a', 'd', 'c']);
  });
});
