// 발주서 ↔ BOM 직결 (2026-09-05 안 B 3단계)
import { describe, it, expect } from 'vitest';
import { mergeBomLinks, primaryBomProjectId, bomLinksLabel } from '../../src/domain/purchaseBom';

describe('발주서 BOM 링크', () => {
  it('같은 프로젝트·타입은 한 번만, 다른 타입은 늘어난다', () => {
    let l = mergeBomLinks([], { projectId: 'p1', projectName: '프로버', variantKey: 'a', variantLabel: 'T5391' });
    l = mergeBomLinks(l, { projectId: 'p1', projectName: '프로버', variantKey: 'a', variantLabel: 'T5391' });
    expect(l).toHaveLength(1);
    l = mergeBomLinks(l, { projectId: 'p1', projectName: '프로버', variantKey: 'b', variantLabel: 'M7H' });
    expect(l).toHaveLength(2);
    expect(bomLinksLabel(l)).toBe('프로버 · T5391, M7H');
  });
  it('대표 프로젝트는 bomProjectId 우선, 없으면 첫 링크', () => {
    expect(primaryBomProjectId({ bomProjectId: 'x', bomLinks: [{ projectId: 'p1' }] })).toBe('x');
    expect(primaryBomProjectId({ bomLinks: [{ projectId: 'p1' }] })).toBe('p1');
    expect(primaryBomProjectId({})).toBe('');
  });
  it('링크 없는 발주서는 그대로', () => {
    expect(mergeBomLinks(undefined, null)).toEqual([]);
    expect(bomLinksLabel([])).toBe('');
  });
});
