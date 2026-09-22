// 정·역 구분 — 줄마다 어느 방향 호기에 쓰는지 (2026-09-21 대표님 「정역 공통 정,역 개별로 체크」)
import { describe, it, expect } from 'vitest';
import {
  DIRS,
  dirsOf,
  isOutOfScope,
  rowsForPanel,
  dirModeOf,
  dirModePatch,
  dirModeHint,
  isHiddenForPanel,
} from '../../src/domain/panelBom';

const 정 = { 정역: '정' };
const 역 = { 정역: '역' };
const 모름 = { 정역: '' };

describe('줄의 정·역', () => {
  it('안 정했거나 둘 다 켜면 공통', () => {
    expect(dirsOf({})).toEqual([]);
    expect(dirsOf({ dirs: [] })).toEqual([]);
    expect(dirsOf({ dirs: DIRS })).toEqual([]);
  });
  it('하나만 켜면 그 방향', () => {
    expect(dirsOf({ dirs: ['정'] })).toEqual(['정']);
    expect(dirsOf({ dirs: ['역'] })).toEqual(['역']);
  });
  it('옛 「정방향 제외」는 «역만»으로 읽는다', () => {
    expect(dirsOf({ skipForward: true })).toEqual(['역']);
    expect(dirsOf({ skipForward: false })).toEqual([]);
    // dirs 가 있으면 옛 값은 무시한다 — 새로 정한 것이 이긴다
    expect(dirsOf({ skipForward: true, dirs: ['정'] })).toEqual(['정']);
  });
  it('모르는 값은 걸러진다', () => {
    expect(dirsOf({ dirs: ['정', '가짜'] })).toEqual(['정']);
    expect(dirsOf({ dirs: ['가짜'] })).toEqual([]);
  });
});

describe('이 호기에서 셈에 드나', () => {
  it('공통 줄은 어느 호기에서나 셈한다', () => {
    expect(isOutOfScope({}, 정)).toBe(false);
    expect(isOutOfScope({}, 역)).toBe(false);
  });
  it('「정만」 줄은 역방향 호기에서 빠진다', () => {
    expect(isOutOfScope({ dirs: ['정'] }, 정)).toBe(false);
    expect(isOutOfScope({ dirs: ['정'] }, 역)).toBe(true);
  });
  it('「역만」 줄은 정방향 호기에서 빠진다 — 옛 정방향 제외와 같은 동작', () => {
    expect(isOutOfScope({ skipForward: true }, 정)).toBe(true);
    expect(isOutOfScope({ skipForward: true }, 역)).toBe(false);
  });
  it('호기에 정역을 안 적었으면 빼지 않는다 — 빼는 쪽이 위험하다', () => {
    expect(isOutOfScope({ dirs: ['정'] }, 모름)).toBe(false);
    expect(isOutOfScope({ dirs: ['역'] }, {})).toBe(false);
  });
});

describe('호기가 쓰는 줄 — 타입과 방향을 함께', () => {
  const rows = [
    { id: 'common', variantKeys: [] },
    { id: 'fwdOnly', variantKeys: [], dirs: ['정'] },
    { id: 'revOnly', variantKeys: [], skipForward: true },
    { id: 'm7h', variantKeys: ['vM7H'] },
    { id: 'm7hFwd', variantKeys: ['vM7H'], dirs: ['정'] },
  ];
  it('타입과 방향 둘 다 맞아야 든다', () => {
    const panel = { 정역: '정', bomLink: { variantKey: 'vM7H' } };
    expect(rowsForPanel(rows, panel).map((r) => r.id)).toEqual(['common', 'fwdOnly', 'm7h', 'm7hFwd']);
  });
  it('역방향 M7H 호기는 「정만」 줄을 뺀다', () => {
    const panel = { 정역: '역', bomLink: { variantKey: 'vM7H' } };
    expect(rowsForPanel(rows, panel).map((r) => r.id)).toEqual(['common', 'revOnly', 'm7h']);
  });
  it('타입 없는 정방향 호기는 타입 전용 줄까지 본다(전과 같음)', () => {
    expect(rowsForPanel(rows, { 정역: '정' }).map((r) => r.id)).toEqual(['common', 'fwdOnly', 'm7h', 'm7hFwd']);
  });
});

// ── 「회색」과 「안 뜸」 (2026-09-22 대표님 「아예 사용을 안해서 리스트에 안뜨게 하려면」) ──
describe('회색과 안 뜸', () => {
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
  it('호기에 정역을 안 적었으면 숨기지 않는다 — 빼는 쪽이 위험', () => {
    expect(isHiddenForPanel(dirModePatch('fwdNone'), 모름)).toBe(false);
  });
  it('공통은 어느 쪽에서도 회색·숨김이 아니다', () => {
    const row = dirModePatch('');
    for (const p of [정, 역, 모름]) {
      expect(isOutOfScope(row, p)).toBe(false);
      expect(isHiddenForPanel(row, p)).toBe(false);
    }
  });
  it('모드마다 설명이 있다 — 칸에 마우스를 올리면 나온다', () => {
    for (const m of ['fwdGray', 'revGray', 'fwdNone', 'revNone']) expect(dirModeHint(m)).toBeTruthy();
  });
});
