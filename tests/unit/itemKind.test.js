import { describe, it, expect } from 'vitest';
import { MADE, ELEC, mainCodeOf, isMainItem, madeMainCodes, isMade, kindLabel } from '../../src/domain/itemKind';

describe('품목이 전장자재인가 가공품인가', () => {
  const 품목들 = [
    { code: 'IOPN-047', name: '브라켓', kind: MADE }, // 대분류에 표시
    { code: 'IOPN-047-1', name: 'BASE PLATE' },
    { code: 'IOPN-014', name: 'CP' },
    { code: 'IOPN-014-19', name: 'CP', spec: 'FAZ-C35' },
  ];
  const 가공대분류 = madeMainCodes(품목들);

  it('대분류 코드만 떼어 낸다', () => {
    expect(mainCodeOf('IOPN-014-19')).toBe('IOPN-014');
    expect(mainCodeOf('IOPN-014')).toBe('IOPN-014');
    expect(mainCodeOf('')).toBe('');
  });

  it('대분류 품목인지 가린다 — 소분류가 붙으면 아니다', () => {
    expect(isMainItem({ code: 'IOPN-014' })).toBe(true);
    expect(isMainItem({ code: 'IOPN-014-19' })).toBe(false);
  });

  it('대분류에 한 번 표시하면 그 아래 품목이 모두 가공품이 된다', () => {
    // 대표님 「내가 품목에 추가하고 알아서 넣을게 연동만 잘되게해줘」
    expect(가공대분류).toEqual(new Set(['IOPN-047']));
    expect(isMade({ code: 'IOPN-047-1' }, 가공대분류)).toBe(true);
    expect(isMade({ code: 'IOPN-014-19' }, 가공대분류)).toBe(false);
  });

  it('줄에 직접 적은 갈래가 대분류보다 먼저다', () => {
    expect(isMade({ code: 'IOPN-014-19', kind: MADE }, 가공대분류)).toBe(true);
    expect(isMade({ code: 'IOPN-047-1', kind: ELEC }, 가공대분류)).toBe(false);
  });

  it('표시된 대분류가 하나도 없으면 전부 전장자재다', () => {
    const 빈것 = madeMainCodes([{ code: 'IOPN-014' }]);
    expect(빈것.size).toBe(0);
    expect(isMade({ code: 'IOPN-047-1' }, 빈것)).toBe(false);
  });

  it('이름을 돌려준다', () => {
    expect(kindLabel({ code: 'IOPN-047-1' }, 가공대분류)).toBe('가공품');
    expect(kindLabel({ code: 'IOPN-014-19' }, 가공대분류)).toBe('전장자재');
  });
});
