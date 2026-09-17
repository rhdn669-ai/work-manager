// 타입(형번)이 바뀔 때 어긋나는 줄 (2026-09-17 대표님 「보라색 띠로 표시」)
import { describe, it, expect } from 'vitest';
import { rowFitsVariant, strayRows, variantChangePlan } from '../../src/domain/variantShift';

const common = { id: 'c', name: 'CP', variantKeys: [] };
const onlyM7H = { id: 'm', name: 'Relay', variantKeys: ['vM7H'] };
const onlyT = { id: 't', name: 'LAN', variantKeys: ['vT5391'] };
const rows = [common, onlyM7H, onlyT];

describe('줄이 이 타입 것인가', () => {
  it('공통 자재는 어느 타입에서나 보인다', () => {
    expect(rowFitsVariant(common, 'vM7H')).toBe(true);
    expect(rowFitsVariant(common, '')).toBe(true);
  });
  it('전용 줄은 그 타입에서만', () => {
    expect(rowFitsVariant(onlyM7H, 'vM7H')).toBe(true);
    expect(rowFitsVariant(onlyM7H, 'vT5391')).toBe(false);
  });
  it('타입 미지정 호기는 전용 줄도 모두 본다 — 그래서 경고 대상', () => {
    expect(rowFitsVariant(onlyM7H, '')).toBe(true);
    expect(rowFitsVariant(onlyT, '')).toBe(true);
  });
});

describe('보라 줄 — 지금 타입 밖인데 체크된 것', () => {
  it('타입 밖이고 체크가 있으면 잡는다', () => {
    const got = (r) => (r.id === 'm' ? 4 : 0);
    expect(strayRows(rows, 'vT5391', got).map((r) => r.id)).toEqual(['m']);
  });
  it('체크가 없으면 안 잡는다 — 그냥 안 쓰는 줄이다', () => {
    expect(strayRows(rows, 'vT5391', () => 0)).toEqual([]);
  });
  it('타입 미지정이면 모든 줄이 제 자리라 하나도 안 잡는다', () => {
    expect(strayRows(rows, '', () => 9)).toEqual([]);
  });
});

describe('타입을 바꾸면', () => {
  const got = (r) => ({ c: 2, m: 4, t: 8 })[r.id] || 0;

  it('사라지는 줄 가운데 체크가 있는 것만 경고한다', () => {
    const p = variantChangePlan(rows, 'vT5391', 'vM7H', got);
    expect(p.leaving.map((x) => x.row.id)).toEqual(['t']);
    expect(p.leavingQty).toBe(8);
    expect(p.arriving.map((r) => r.id)).toEqual(['m']);
  });

  it('공통 자재는 어느 쪽으로 바꿔도 그대로다', () => {
    const p = variantChangePlan(rows, 'vM7H', 'vT5391', got);
    expect(p.leaving.map((x) => x.row.id)).not.toContain('c');
    expect(p.arriving.map((r) => r.id)).not.toContain('c');
  });

  it('체크가 0 인 줄은 사라져도 경고하지 않는다', () => {
    const p = variantChangePlan(rows, 'vT5391', 'vM7H', (r) => (r.id === 't' ? 0 : 1));
    expect(p.leaving).toEqual([]);
  });

  it('타입 미지정 → 지정: 반대쪽 전용 줄이 통째로 사라진다 (호기 10대가 여기 해당)', () => {
    const p = variantChangePlan(rows, '', 'vT5391', got);
    expect(p.leaving.map((x) => x.row.id)).toEqual(['m']); // M7H 전용이 빠진다
    expect(p.leavingQty).toBe(4);
    expect(p.arriving).toEqual([]); // 새로 생기는 줄은 없다
  });

  it('지정 → 미지정: 사라지는 줄 없이 전용 줄이 늘어난다', () => {
    const p = variantChangePlan(rows, 'vT5391', '', got);
    expect(p.leaving).toEqual([]);
    expect(p.arriving.map((r) => r.id)).toEqual(['m']);
  });
});
