// 판넬 ↔ BOM 연결 (2026-09-03 대표님 「호기별로 자재 사급 도급 리스트」).
import { describe, it, expect } from 'vitest';
import { CHECKABLE_BOXES, hasBomLink, makeBomLink, siblingsForCopy, bomRowsForBox } from '../../src/domain/panelBom';

describe('연결 값', () => {
  it('MP 는 체크 대상에서 뺀다 — 하위 9종을 따로 관리한다', () => {
    expect(CHECKABLE_BOXES).not.toContain('MP');
    expect(CHECKABLE_BOXES).toContain('P/W BOX');
  });
  it('프로젝트가 없으면 연결이 아니다', () => {
    expect(makeBomLink({})).toBeNull();
    expect(hasBomLink({ bomLink: null })).toBe(false);
    expect(hasBomLink({ bomLink: { projectId: 'x' } })).toBe(true);
  });
  it('형태를 고정한다 — 빈 값은 빈 문자열, 이름은 다듬는다', () => {
    expect(makeBomLink({ projectId: 'p1', projectName: ' 프로버 ', variantKey: undefined })).toEqual({
      projectId: 'p1',
      projectName: '프로버',
      variantKey: '',
      variantLabel: '',
    });
  });
});

describe('같은 프로젝트 호기에 복사', () => {
  const me = { id: 'a', 회사: '메티스', 프로젝트: 'YS-TEPS', bomLink: { projectId: 'p1', variantKey: 'v1' } };
  const panels = [
    me,
    { id: 'b', 회사: '메티스', 프로젝트: 'YS-TEPS' }, // 대상
    { id: 'c', 회사: '메티스', 프로젝트: 'YS-TEPS', bomLink: { projectId: 'p1', variantKey: 'v1' } }, // 이미 같음
    { id: 'd', 회사: '메티스', 프로젝트: 'YS-TEPS', bomLink: { projectId: 'p1', variantKey: 'v2' } }, // 타입 다름 → 대상
    { id: 'e', 회사: '디에이치', 프로젝트: 'YS-TEPS' }, // 회사 다름
    { id: 'f', 회사: '메티스', 프로젝트: 'OTHER' }, // 프로젝트 다름
  ];
  it('같은 회사의 다른 호기 가운데 아직 같은 연결이 아닌 것 — 프로젝트명은 안 본다', () => {
    // 실제 데이터는 호기마다 프로젝트명이 다르다(YS-TEPS0926165 · …167). 이름으로 묶으면 아무도 안 잡힌다
    expect(siblingsForCopy(panels, me).map((q) => q.id)).toEqual(['b', 'd', 'f']);
  });
  it('자기 자신은 빠진다', () => {
    expect(siblingsForCopy([me], me)).toEqual([]);
  });
});

describe('BOX 로 BOM 줄 고르기', () => {
  const rows = [
    { id: 1, box: 'P/W BOX' },
    { id: 2, box: 'H/T BOX 상' },
    { id: 3, box: ' P/W BOX ' },
    { id: 4, box: '' },
  ];
  it('이름이 같은 줄만 — 앞뒤 공백은 넘어간다', () => {
    expect(bomRowsForBox(rows, 'P/W BOX').map((r) => r.id)).toEqual([1, 3]);
  });
  it('BOX 가 빈 줄은 어느 BOX 에도 안 잡힌다', () => {
    expect(bomRowsForBox(rows, '').map((r) => r.id)).toEqual([4]);
    expect(bomRowsForBox(rows, 'ROBOT')).toEqual([]);
  });
});
