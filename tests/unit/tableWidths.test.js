// 칸 폭 배분의 합은 반드시 100 이어야 한다.
//
// 넘치면 어느 칸이 찌그러지고, 열 수와 배분 수가 어긋나면 폭이 한 칸씩 밀린다.
// 실제로 도번 열을 늘리며 발주서 배분을 안 늘려, 규격이 받을 17% 를 메이커가
// 가져가고 규격은 83px 로 눌려 있었다 (2026-09-02).
import { describe, it, expect } from 'vitest';
import { BOM_COLS_WITH_VARIANT, BOM_COLS_NO_VARIANT, PO_COLS, STOCK_COLS, sumOf } from '../../src/domain/tableWidths';

describe('품목 표 칸 폭', () => {
  it('BOM(타입 있음) 합이 100', () => {
    expect(sumOf(BOM_COLS_WITH_VARIANT)).toBe(100);
  });

  it('BOM(타입 없음) 합이 100', () => {
    expect(sumOf(BOM_COLS_NO_VARIANT)).toBe(100);
  });

  it('발주서 합이 100', () => {
    expect(sumOf(PO_COLS)).toBe(100);
  });

  it('타입 열이 빠지면 배분도 하나 줄어든다', () => {
    expect(BOM_COLS_NO_VARIANT.length).toBe(BOM_COLS_WITH_VARIANT.length - 1);
  });

  it('규격이 가장 넓다 — 이 표에서 제일 긴 값이 들어간다', () => {
    for (const cols of [BOM_COLS_WITH_VARIANT, BOM_COLS_NO_VARIANT, PO_COLS]) {
      const sorted = [...cols].sort((a, b) => b - a);
      // 가장 넓은 칸(규격)이 그다음보다 확실히 넓어야 한다
      expect(sorted[0]).toBeGreaterThan(sorted[1]);
    }
  });

  it('재고 표 폭은 한 벌뿐 — 사급·도급이 같은 값을 쓴다 (2026-09-12 대표님)', () => {
    // 따로 적어 두었더니 남음 칸이 9% 와 13% 로 어긋나 있었다.
    expect(STOCK_COLS).toHaveLength(9);
    // 「남은 공간 전부」는 규격 한 칸뿐 — 둘이면 브라우저가 제멋대로 나눈다
    expect(STOCK_COLS.filter((w) => w === null)).toHaveLength(1);
    const pct = STOCK_COLS.filter((w) => typeof w === 'string' && w.endsWith('%')).map((w) => parseFloat(w));
    expect(pct.reduce((a, b) => a + b, 0)).toBeLessThan(100); // 규격이 쓸 자리가 남아야 한다
  });

  it('도번과 BOX 는 같은 폭 — 나란히 놓이는 두 칸이다 (2026-09-02 대표님)', () => {
    // BOM: 여백·No 다음이 코드·도번·BOX
    expect(BOM_COLS_WITH_VARIANT[3]).toBe(BOM_COLS_WITH_VARIANT[4]);
    expect(BOM_COLS_NO_VARIANT[3]).toBe(BOM_COLS_NO_VARIANT[4]);
    // 발주서: No 다음이 도번·BOX (코드 열 없음)
    expect(PO_COLS[1]).toBe(PO_COLS[2]);
  });
});
