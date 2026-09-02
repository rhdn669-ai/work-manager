// 사급 장의 인쇄 (2026-09-02 대표님 「사급 출력물 수량 글씨 틀어짐」).
//
// 사급에는 금액이 없다. 그런데 단가·금액 열을 그대로 두면 그 열에 값이 하나도 없어
// 폭이 무너지고, 뒤따르는 수량·비고 글자가 칸에서 밀려난다. 그래서 사급만 실린 장은
// 금액 열을 아예 그리지 않고, 금액 없는 폭 배분(bom-no-price)을 쓴다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/pages/admin/BomDetailPage.jsx'), 'utf8');

describe('사급 장 인쇄', () => {
  it('그 장이 통째로 사급인지 본다', () => {
    expect(src).toContain('const freePage = chunk.length > 0 && chunk.every(isFreeIssue)');
  });

  it('사급 장에서는 금액 열을 그리지 않는다', () => {
    expect(src).toContain('const showAmount = printShowAmount && !freePage');
  });

  it('표에 금액 없는 폭 배분을 준다', () => {
    // 클래스가 printShowAmount 를 그대로 보면 폭이 어긋난 채로 남는다
    expect(src).toMatch(/iopn-items-table\$\{showAmount \? '' : ' bom-no-price'\}/);
  });

  it('도급·사급이 한 장에 섞이면 「사급」 표기는 그대로 쓴다', () => {
    // 구매처별 묶음처럼 섞이는 자리가 있어 이 분기는 남아야 한다
    expect(src).toContain('c-amount c-free');
    expect(src).toContain('colSpan={2}');
  });
});

describe('BOX 필터', () => {
  it('걸러 놓은 상태가 인쇄에도 그대로 간다', () => {
    // rows 를 걸러 두면 printRows 가 그것을 받는다
    expect(src).toContain('const printRows = groupBySupplier ? supplierGroups.flatMap((g) => g.items) : rows');
    expect(src).toMatch(/if \(boxFilter\) \{/);
  });

  it('고른 뒤 되돌릴 길이 있다 — 「BOX 전체」', () => {
    expect(src).toContain("{ value: '', label: 'BOX 전체' }");
    expect(src).toContain("{ value: '', label: '구매처 전체' }");
  });

  it('걸러 놓은 화면에서는 순서를 끌지 못한다', () => {
    // 안 보이는 줄까지 순서가 밀린다
    expect(src).toMatch(/canDragRows =[\s\S]{0,120}!boxFilter/);
  });
});
