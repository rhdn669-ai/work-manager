// 호기 자재 체크의 셈 (2026-09-03 대표님).
import { describe, it, expect } from 'vitest';
import {
  receivedQty,
  shortageOf,
  rowDone,
  boxKindComplete,
  boxSummary,
  aggregateShortage,
} from '../../src/domain/panelMaterials';

const paid = (id, qty, extra = {}) => ({ id, qty, supplyType: '', itemId: `m-${id}`, code: `C${id}`, ...extra });
const free = (id, qty, extra = {}) => ({ id, qty, supplyType: 'free', itemId: `m-${id}`, code: `C${id}`, ...extra });

describe('한 줄', () => {
  it('부족 = BOM 수량 - 들어온 개수, 넘쳐도 0', () => {
    expect(shortageOf(4, 3)).toBe(1);
    expect(shortageOf(4, 9)).toBe(0);
    expect(shortageOf(0, 0)).toBe(0);
  });
  it('기록이 없으면 0개', () => {
    expect(receivedQty({}, 'x')).toBe(0);
    expect(receivedQty(null, 'x')).toBe(0);
    expect(receivedQty({ x: { qty: '3' } }, 'x')).toBe(3);
  });
  it('그 호기에서 일시 제외한 줄은 찬 것으로 보고 집계에서도 빠진다', () => {
    expect(rowDone(paid('a', 2), { a: { qty: 0, skip: true } })).toBe(true);
    expect(boxKindComplete([paid('a', 2), paid('b', 1)], { a: { qty: 0, skip: true }, b: { qty: 1 } }, 'paid')).toBe(
      true,
    );
    const out = aggregateShortage([
      { panelLabel: '1호기', rows: [paid('a', 2)], received: { a: { qty: 0, skip: true } } },
    ]);
    expect(out).toEqual([]);
  });
  it('BOM 수량이 0 인 줄은 찬 것으로 본다 — 수량 미정을 부족으로 몰지 않는다', () => {
    expect(rowDone(paid('a', 0), {})).toBe(true);
    expect(rowDone(paid('a', 2), { a: { qty: 1 } })).toBe(false);
    expect(rowDone(paid('a', 2), { a: { qty: 2 } })).toBe(true);
  });
});

describe('BOX 완료 판정', () => {
  const rows = [paid('a', 2), paid('b', 1), free('c', 3)];
  it('도급 줄이 전부 차야 도급 완료', () => {
    expect(boxKindComplete(rows, { a: { qty: 2 } }, 'paid')).toBe(false);
    expect(boxKindComplete(rows, { a: { qty: 2 }, b: { qty: 1 } }, 'paid')).toBe(true);
  });
  it('사급은 사급 줄만 본다', () => {
    expect(boxKindComplete(rows, { c: { qty: 3 } }, 'free')).toBe(true);
    expect(boxKindComplete(rows, { a: { qty: 2 }, b: { qty: 1 } }, 'free')).toBe(false);
  });
  it('해당 구분의 줄이 하나도 없으면 완료가 아니다 — 빈 것을 「다 왔다」고 하면 자재 칸이 속인다', () => {
    expect(boxKindComplete([paid('a', 1)], { a: { qty: 1 } }, 'free')).toBe(false);
    expect(boxKindComplete([], {}, 'paid')).toBe(false);
  });
  it('요약 — 도급 1/2 · 사급 1/1 (판금은 따로 센다)', () => {
    expect(boxSummary(rows, { a: { qty: 2 }, c: { qty: 3 } })).toEqual({
      paid: { done: 1, total: 2 },
      free: { done: 1, total: 1 },
      made: { done: 0, total: 0 },
    });
  });

  it('판금으로 표시된 줄은 도급·사급 어느 쪽도 아니다 (2026-09-12 대표님)', () => {
    const 판금인가 = (r) => r.id === 'a';
    expect(boxSummary(rows, { a: { qty: 2 }, c: { qty: 3 } }, 판금인가)).toEqual({
      paid: { done: 0, total: 1 },
      free: { done: 1, total: 1 },
      made: { done: 1, total: 1 },
    });
  });

  it('판금만 따로 다 찼는지 본다', () => {
    const 판금인가 = (r) => r.id === 'a';
    expect(boxKindComplete(rows, { a: { qty: 2 } }, 'made', 판금인가)).toBe(true);
    expect(boxKindComplete(rows, {}, 'made', 판금인가)).toBe(false);
    // 판금 줄은 도급 셈에서 빠진다
    expect(boxKindComplete(rows, { a: { qty: 2 } }, 'paid', 판금인가)).toBe(false);
  });
});

describe('호기 범위 부족 집계', () => {
  it('같은 품목은 호기가 달라도 한 줄로 합치고, 모자란 호기를 적는다', () => {
    const out = aggregateShortage([
      {
        panelLabel: '5호기',
        rows: [paid('r1', 4, { itemId: 'M1', code: 'IOPN-1', name: 'Relay' })],
        received: { r1: { qty: 1 } },
      },
      {
        panelLabel: '7호기',
        rows: [paid('r9', 4, { itemId: 'M1', code: 'IOPN-1', name: 'Relay' })],
        received: { r9: { qty: 4 } },
      },
      { panelLabel: '9호기', rows: [paid('r5', 2, { itemId: 'M1', code: 'IOPN-1', name: 'Relay' })], received: {} },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ itemId: 'M1', need: 10, got: 5, short: 5, panels: ['5호기', '9호기'] });
  });
  it('다 찬 품목은 목록에 안 나온다', () => {
    const out = aggregateShortage([{ panelLabel: '1호기', rows: [paid('r1', 2)], received: { r1: { qty: 2 } } }]);
    expect(out).toEqual([]);
  });
  it('부족이 큰 것부터', () => {
    const out = aggregateShortage([
      {
        panelLabel: '1호기',
        rows: [paid('a', 1, { itemId: 'A' }), paid('b', 5, { itemId: 'B' })],
        received: {},
      },
    ]);
    expect(out.map((x) => x.itemId)).toEqual(['B', 'A']);
  });
  it('품목 마스터가 없는 손으로 적은 줄도 잃지 않는다', () => {
    const out = aggregateShortage([{ panelLabel: '1호기', rows: [{ id: 'z', qty: 1, code: 'X' }], received: {} }]);
    expect(out[0].short).toBe(1);
  });
});
