// 보관함 열쇠 — 사내 서버는 열쇠에 한글을 못 받는다 (2026-09-18 「pdf 자료실 저장중 오류」)
import { describe, it, expect } from 'vitest';
import { asciiExt, storageKeyName } from '../../src/domain/storageKey';

describe('보관함 열쇠 이름', () => {
  it('한글·공백·괄호가 든 이름도 도장+확장자만 남는다', () => {
    expect(storageKeyName('(주)에이티이엔지_AT-기업은행 통장사본.pdf', '1789721834872_566304')).toBe(
      '1789721834872_566304.pdf',
    );
  });
  it('열쇠에는 영문·숫자·밑줄·점만 남는다', () => {
    const k = storageKeyName('사업자등록증(25년).JPG', 'abc_1');
    expect(k).toBe('abc_1.jpg');
    expect(/^[A-Za-z0-9_.]+$/.test(k)).toBe(true);
  });
  it('확장자가 없거나 한글이면 bin', () => {
    expect(asciiExt('통장사본')).toBe('bin');
    expect(asciiExt('파일.한글')).toBe('bin');
    expect(asciiExt('')).toBe('bin');
  });
});
