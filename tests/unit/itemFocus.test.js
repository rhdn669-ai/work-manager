// 품목 표에서 커서가 제멋대로 움직이면 안 된다 (2026-09-02 대표님 「품명 검색하는
// 도중에 코드로 갑자기 입력칸이 넘어가서 코드를 자꾸 건들여짐」).
//
// autoFocus 는 그 행이 «마운트될 때마다» 발동한다. 저장 안 한 새 행이 남은 채로
// 검색을 치면 행이 걸러졌다 돌아오기를 되풀이하고, 돌아올 때마다 커서를 끌어가
// 검색어가 코드에 박혔다. 그래서 「최초 한 번」으로 바꿨고, 되돌아가지 않게 고정한다.
//
// 렌더 테스트 환경이 없어 규칙 자체를 문자열로 읽어 확인한다 (modalEnter.test.js 와 같은 방식).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/pages/admin/PurchaseItemPage.jsx'), 'utf8');

// 품목 한 줄 — 검색·필터가 바뀔 때마다 마운트를 되풀이하는 곳이다.
// (모달 안 입력칸은 열 때 한 번만 마운트되므로 autoFocus 가 있어도 된다)
const row = src.slice(src.indexOf('<SortableItemRow'), src.indexOf('</SortableItemRow>'));

describe('품목 표 — 커서는 제자리에 있어야 한다', () => {
  it('품목 한 줄의 입력칸에 autoFocus 를 쓰지 않는다', () => {
    expect(row).not.toContain('autoFocus');
  });

  it('새 행에는 «한 번만» 커서를 준다', () => {
    expect(src).toContain('const focusOnceRef = useRef(null)');
    // 준 다음 곧바로 비운다 — 재마운트되어도 두 번은 없다
    expect(src).toMatch(/focusOnceRef\.current = null;[^\n]*\n\s*el\.focus\(\)/);
  });

  it('새 행을 만들 때만 예약한다', () => {
    expect(src).toContain('focusOnceRef.current = tmpId');
  });
});

describe('겹치는 도번 — 상단 알림', () => {
  it('검색·필터가 아니라 «전체» 품목을 본다', () => {
    // filtered 를 보면 걸러 놓은 화면에서만 조용해진다 — 알림이 아니다
    const block = src.slice(src.indexOf('const dupDrawings'), src.indexOf('}, [items]);') + 12);
    expect(block).toContain('for (const it of items)');
    expect(block).not.toContain('filtered');
  });

  it('둘 이상 붙은 도번만 골라낸다', () => {
    const block = src.slice(src.indexOf('const dupDrawings'), src.indexOf('}, [items]);'));
    expect(block).toContain('list.length > 1');
  });

  it('빈 도번은 세지 않는다', () => {
    const block = src.slice(src.indexOf('const dupDrawings'), src.indexOf('}, [items]);'));
    expect(block).toMatch(/if \(!dn\) continue;/);
  });

  it('겹친 것이 없으면 알림 자체를 그리지 않는다', () => {
    expect(src).toContain('{dupDrawings.length > 0 && (');
  });
});
