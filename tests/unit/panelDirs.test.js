import { describe, it, expect } from 'vitest';
import { dirModeOf, dirModePatch, dirModeHint, isOutOfScope, isHiddenForPanel } from '../../src/domain/panelBom';

const 정 = { 정역: '정' };
const 역 = { 정역: '역' };
const 미정 = { 정역: '' };

describe('정·역 — 회색과 안 뜸', () => {
  it('다섯 모드가 왕복한다', () => {
    for (const m of ['', 'fwdGray', 'revGray', 'fwdNone', 'revNone']) {
      expect(dirModeOf(dirModePatch(m))).toBe(m);
    }
  });
  it('옛 줄(dirs:[역])은 「정 회색」으로 읽힌다 — 이전 없이 동작이 같다', () => {
    const row = { dirs: ['역'] };
    expect(dirModeOf(row)).toBe('fwdGray');
    expect(isOutOfScope(row, 정)).toBe(true);
    expect(isHiddenForPanel(row, 정)).toBe(false);
  });
  it('옛 「정방향 제외」(skipForward)도 「정 회색」', () => {
    expect(dirModeOf({ skipForward: true })).toBe('fwdGray');
  });
  it('「정 없음」은 정방향에서 안 뜬다', () => {
    const row = dirModePatch('fwdNone');
    expect(isHiddenForPanel(row, 정)).toBe(true);
    expect(isHiddenForPanel(row, 역)).toBe(false);
    expect(isOutOfScope(row, 역)).toBe(false);
  });
  it('「역 없음」은 역방향에서 안 뜬다', () => {
    const row = dirModePatch('revNone');
    expect(isHiddenForPanel(row, 역)).toBe(true);
    expect(isHiddenForPanel(row, 정)).toBe(false);
  });
  it('호기에 정역을 안 적었으면 빼지 않는다 — 빼는 쪽이 위험', () => {
    expect(isHiddenForPanel(dirModePatch('fwdNone'), 미정)).toBe(false);
    expect(isOutOfScope(dirModePatch('fwdNone'), 미정)).toBe(false);
  });
  it('공통은 어느 쪽에서도 회색·숨김이 아니다', () => {
    const row = dirModePatch('');
    for (const p of [정, 역, 미정]) {
      expect(isOutOfScope(row, p)).toBe(false);
      expect(isHiddenForPanel(row, p)).toBe(false);
    }
  });
  it('모드마다 설명이 있다', () => {
    for (const m of ['fwdGray', 'revGray', 'fwdNone', 'revNone']) expect(dirModeHint(m)).toBeTruthy();
  });
});
