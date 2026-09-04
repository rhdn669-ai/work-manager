// 정역 자동 (2026-09-04 대표님 「끝자리 짝수는 정, 홀수는 역 자동 입력」)
import { describe, it, expect } from 'vitest';
import { autoDir, withAutoDir } from '../../src/domain/production';

describe('정역 자동', () => {
  it('호기 이름 맨 뒷자리 숫자로 — 짝수 정, 홀수 역', () => {
    expect(autoDir('YS-TEPS0926273')).toBe('역');
    expect(autoDir('YS-TEPS0926274')).toBe('정');
    expect(autoDir('H0123-2 정')).toBe('정');
    expect(autoDir('')).toBe('');
    expect(autoDir('ABC')).toBe('');
  });
  it('프로젝트가 든 저장에만 채우고, 정역을 따로 준 건 안 건드린다', () => {
    expect(withAutoDir({ 프로젝트: 'YS-1' })).toEqual({ 프로젝트: 'YS-1', 정역: '역' });
    expect(withAutoDir({ 프로젝트: 'YS-2', 정역: '역' })).toEqual({ 프로젝트: 'YS-2', 정역: '역' });
    expect(withAutoDir({ 납기: '2026-09-10' })).toEqual({ 납기: '2026-09-10' });
  });
});
