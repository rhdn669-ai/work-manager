// 표의 「열 복사 드래그」가 입력칸 클릭까지 삼키면 안 된다.
//
// mousedown 에서 preventDefault 하면 클릭해도 커서가 들어가지 않는다. 그러면 바로
// 이어서 친 Ctrl+V 가 갈 곳이 없어 통째로 씹힌다. Tab 으로 옮겨 간 칸에서는 멀쩡하고
// 클릭해서 들어간 칸에서만 안 되니 「간헐적」으로 보였다
// (2026-09-02 대표님 「앱에 붙여넣기가 간헐적으로 씹히는데」).
//
// 렌더 테스트 환경이 없어 규칙 자체를 문자열로 읽어 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/pages/admin/PurchaseDetailPage.jsx'), 'utf8');
const fn = src.slice(src.indexOf('function handleColumnDragCopy'), src.indexOf('function handleColumnDragCopy') + 1400);

describe('열 복사 드래그 — 붙여넣기를 막지 않는다', () => {
  it('입력칸을 누르면 아무것도 하지 않고 물러난다', () => {
    expect(fn).toMatch(/e\.target\.closest\('input, textarea, select, button, a, \[contenteditable\]'\)\)\s*return;/);
  });

  it('그 검사가 preventDefault 보다 «먼저» 와야 한다', () => {
    const guard = fn.indexOf("e.target.closest('input");
    const prevent = fn.indexOf('e.preventDefault()');
    expect(guard).toBeGreaterThan(-1);
    expect(prevent).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(prevent);
  });

  it('칸의 여백을 끌면 여전히 열 복사가 시작된다', () => {
    // 가드를 넣으면서 기능까지 죽이지 않았는지
    expect(fn).toContain("const td = e.target.closest('td')");
    expect(fn).toContain('e.preventDefault()');
  });
});
