// 인쇄물 칸 폭 — CSS 를 직접 읽어 검사한다.
//
// 조합마다 합이 정확히 100% 여야 한다. 넘치면 어느 칸이 0 이 되어 통째로 사라지고
// (메이커가 그랬다), 모자라면 글자가 칸에서 밀려난다 (수량이 그랬다).
// BOX 와 도번은 나란히 놓이는 두 칸이라 폭이 같아야 한다
// (2026-09-02 대표님 「출력물에 박스 도번 사이즈 동일하게 … 수량 틀어진것도」).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../../src/styles/global.css'), 'utf8');

// BOM 인쇄표: 조합마다 열 폭이 한 벌씩 생성돼 있다 (:not(.po-cols) 로 발주서와 구분)
const bomBlocks = new Map();
const re = /(\.iopn-items-table(?:[.:][^\s{]*)*:not\(\.po-cols\)) \.(c-[a-z]+) \{\s*width: ([\d.]+)%;/g;
let m;
while ((m = re.exec(css)) !== null) {
  if (!bomBlocks.has(m[1])) bomBlocks.set(m[1], {});
  bomBlocks.get(m[1])[m[2]] = Number(m[3]);
}

describe('BOM 인쇄표 칸 폭', () => {
  it('조합이 열여섯 벌 다 있다 — 금액·BOX·도번·구매처', () => {
    expect(bomBlocks.size).toBe(16);
  });

  it('조합마다 합이 정확히 100%', () => {
    const bad = [];
    for (const [sel, cols] of bomBlocks) {
      const sum = Number(Object.values(cols).reduce((a, b) => a + b, 0).toFixed(1));
      if (sum !== 100) bad.push(`${sum}% ${sel}`);
    }
    expect(bad).toEqual([]);
  });

  it('BOX 와 도번은 같은 폭', () => {
    const bad = [];
    for (const [sel, cols] of bomBlocks) {
      if (cols['c-box'] != null && cols['c-drawing'] != null && cols['c-box'] !== cols['c-drawing']) {
        bad.push(`${sel} — BOX ${cols['c-box']}% / 도번 ${cols['c-drawing']}%`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('수량 칸이 3% 아래로 눌리지 않는다 — 숫자가 밀려난다', () => {
    for (const [, cols] of bomBlocks) {
      if (cols['c-qty'] != null) expect(cols['c-qty']).toBeGreaterThanOrEqual(3);
    }
  });

  it('규격이 가장 넓다', () => {
    for (const [, cols] of bomBlocks) {
      const vals = Object.values(cols).sort((a, b) => b - a);
      expect(cols['c-spec']).toBe(vals[0]);
    }
  });
});

describe('발주서 인쇄표 칸 폭', () => {
  // 셀렉터에 특수문자가 많아 정규식 대신 문자열로 찾는다
  const grab = (sel, col) => {
    const key = `${sel} .${col} {`;
    const i = css.indexOf(key);
    if (i < 0) return null;
    const hit = css.slice(i + key.length, i + key.length + 60).match(/width:\s*([\d.]+)%/);
    return hit ? Number(hit[1]) : null;
  };

  it('BOX 와 도번이 같은 폭', () => {
    const box = grab('.iopn-items-table.po-cols.has-box', 'c-box');
    const drawing = grab('.iopn-items-table.po-cols.has-drawing', 'c-drawing');
    expect(box).not.toBeNull();
    expect(drawing).not.toBeNull();
    expect(box).toBe(drawing);
  });

  it('둘 다 켜도 규격이 지나치게 눌리지 않는다', () => {
    expect(grab('.iopn-items-table.po-cols.has-drawing.has-box', 'c-spec')).toBeGreaterThanOrEqual(15);
  });
});

describe('인쇄표 칸 정렬', () => {
  const rule = (col) => {
    const key = `.iopn-items-table .${col} {`;
    const i = css.indexOf(key);
    if (i < 0) return null;
    return css.slice(i + key.length, css.indexOf('}', i));
  };
  const val = (col, prop) => {
    const body = rule(col);
    if (!body) return null;
    const i = body.indexOf(`${prop}:`);
    if (i < 0) return null;
    return body
      .slice(i + prop.length + 1, body.indexOf(';', i))
      .trim();
  };


  it('수량은 가운데 — 어디서나', () => {
    expect(val('c-qty', 'text-align')).toBe('center');
  });

  it('가운데 정렬 칸은 좌우 패딩이 같다 — 한쪽만 남으면 글자가 밀린다', () => {
    // 조합 규칙이 이 칸들을 가운데로 덮는다. 예전에 수량이 오른쪽 패딩만 남아 밀렸다.
    for (const col of ['c-qty', 'c-supplier', 'c-note']) {
      expect(val(col, 'padding-left')).toBe(val(col, 'padding-right'));
    }
  });

  it('돈은 오른쪽 — 자릿수를 맞춘다', () => {
    expect(val('c-price', 'text-align')).toBe('right');
    expect(val('c-amount', 'text-align')).toBe('right');
  });

  it('규격은 왼쪽 — 긴 글이 들어간다', () => {
    expect(val('c-spec', 'text-align')).toBe('left');
  });

  it('생성된 조합에서도 수량은 가운데', () => {
    const bad = [];
    for (const [sel] of bomBlocks) {
      const key = `${sel} .c-qty {`;
      const i = css.indexOf(key);
      if (i < 0) continue;
      const body = css.slice(i + key.length, css.indexOf('}', i));
      if (!/text-align:\s*center/.test(body)) bad.push(sel);
    }
    expect(bad).toEqual([]);
  });
});

