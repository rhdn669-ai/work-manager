// 도급 세트 셈 (2026-09-03 대표님).
import { describe, it, expect } from 'vitest';
import {
  computeSets,
  eligiblePanels,
  panelSeq,
  perSetByItem,
  groupKey,
  fillPlan,
  consumedByItem,
  panelShortage,
} from '../../src/domain/paidSets';

const paid = (itemId, qty, extra = {}) => ({ id: `r-${itemId}-${qty}`, itemId, qty, supplyType: '', ...extra });
const free = (itemId, qty) => ({ id: `f-${itemId}`, itemId, qty, supplyType: 'free' });

describe('세트당 수량', () => {
  it('같은 품목이 여러 BOX 에 있으면 합친다, 사급은 뺀다', () => {
    const { byItem, unlinked } = perSetByItem([paid('A', 2, { box: 'P/W BOX' }), paid('A', 3, { box: 'L/D BOX' }), free('B', 9)]);
    expect(byItem.get('A').perSet).toBe(5);
    expect(byItem.has('B')).toBe(false);
    expect(unlinked).toBe(0);
  });
  it('품목 id 가 없는 줄은 셀 수 없어 따로 센다', () => {
    const { byItem, unlinked } = perSetByItem([{ id: 'x', qty: 1, code: 'HAND' }, paid('A', 1)]);
    expect(byItem.size).toBe(1);
    expect(unlinked).toBe(1);
  });
});

describe('세트 수', () => {
  const rows = [paid('A', 2), paid('B', 1)];
  it('가장 모자란 품목이 세트 수를 정한다', () => {
    const r = computeSets({ rows, receivedByItem: { A: 10, B: 3 } });
    expect(r.sets).toBe(3);
    expect(r.limiter).toBe('B');
    expect(r.items[0].itemId).toBe('B'); // 막는 것부터
  });
  it('배정한 세트만큼 소진하고 남은 것으로 센다', () => {
    const r = computeSets({ rows, receivedByItem: { A: 10, B: 5 }, assigned: 2 });
    const a = r.items.find((x) => x.itemId === 'A');
    expect(a.consumed).toBe(4);
    expect(a.spare).toBe(6);
    expect(r.sets).toBe(3); // A 6/2=3, B (5-2)/1=3
  });
  it('입고가 없으면 0 세트, 음수로 내려가지 않는다', () => {
    const r = computeSets({ rows, receivedByItem: {}, assigned: 1 });
    expect(r.sets).toBe(0);
    expect(r.items.every((x) => x.setsFrom === 0)).toBe(true);
  });
  it('제외한 품목은 세트 수를 정하지 못하고 맨 아래로 간다', () => {
    const r = computeSets({ rows: [paid('A', 1), paid('B', 1)], receivedByItem: { A: 5, B: 0 }, exclude: ['B'] });
    expect(r.sets).toBe(5);
    expect(r.limiter).toBe('A');
    expect(r.items[r.items.length - 1]).toMatchObject({ itemId: 'B', excluded: true });
  });
  it('도급 줄이 하나도 없으면 0 세트', () => {
    expect(computeSets({ rows: [free('B', 1)], receivedByItem: { B: 100 } }).sets).toBe(0);
  });
  it('품목 마스터가 있으면 코드·품명은 마스터 것', () => {
    const r = computeSets({ rows: [paid('A', 1)], receivedByItem: {}, master: { A: { code: 'IOPN-1', name: 'Relay' } } });
    expect(r.items[0].code).toBe('IOPN-1');
  });
});

describe('배정 대상 호기', () => {
  const link = { projectId: 'P', variantKey: 'vT' };
  const panels = [
    { id: '1', 회사: '메티스', 프로젝트: 'YS-TEPS0926165', bomLink: link },
    { id: '2', 회사: '메티스', 프로젝트: 'YS-TEPS0926273', bomLink: link },
    { id: '3', 회사: '메티스', 프로젝트: 'YS-TEPS0926289', bomLink: link },
    { id: '4', 회사: '메티스', 프로젝트: 'YS-TEPS0926300' }, // BOM 미연결
    { id: '5', 회사: '디에이치', 프로젝트: 'DH-999', bomLink: link },
  ];
  it('시작 호기 이상 · BOM 연결 · 같은 회사만, 번호순', () => {
    const out = eligiblePanels(panels, { company: '메티스', startProject: 'YS-TEPS0926273' });
    expect(out.map((p) => p.id)).toEqual(['2', '3']);
  });
  it('시작 호기를 안 정하면 연결된 것 전부', () => {
    expect(eligiblePanels(panels, { company: '메티스', startProject: '' }).map((p) => p.id)).toEqual(['1', '2', '3']);
  });
  it('호기 번호는 이름 끝 숫자', () => {
    expect(panelSeq('YS-TEPS0926273')).toBe(926273);
    expect(panelSeq('없음')).toBe(-1);
  });
  it('묶음 키 = 프로젝트|타입', () => {
    expect(groupKey(panels[0])).toBe('P|vT');
  });
});

describe('있는 만큼만 채우기', () => {
  const rows = [
    { id: 'r1', itemId: 'A', qty: 2, box: 'P/W BOX' },
    { id: 'r2', itemId: 'A', qty: 1, box: 'L/D BOX' },
    { id: 'r3', itemId: 'B', qty: 1, box: 'P/W BOX' },
    { id: 'f1', itemId: 'C', qty: 9, box: 'P/W BOX', supplyType: 'free' },
  ];
  it('여유가 모자라면 앞줄부터 채우고 나머지는 부족으로 남긴다 — BOX 완료 여부도 준다', () => {
    const p = fillPlan({ rows, spareByItem: { A: 2, B: 0 } });
    expect(p.lines.map((l) => [l.id, l.total, l.short])).toEqual([
      ['r1', 2, 0],
      ['r2', 0, 1],
      ['r3', 0, 1],
    ]);
    expect(p.short).toBe(2);
    expect(p.boxes).toEqual({ 'P/W BOX': false, 'L/D BOX': false });
  });
  it('여유가 넉넉하면 전부 채우고 BOX 는 완료', () => {
    const p = fillPlan({ rows, spareByItem: { A: 10, B: 10 } });
    expect(p.short).toBe(0);
    expect(p.boxes).toEqual({ 'P/W BOX': true, 'L/D BOX': true });
  });
  it('제외한 품목은 여유와 무관하게 BOM 수량대로', () => {
    const p = fillPlan({ rows, spareByItem: { A: 0 }, exclude: ['A', 'B'] });
    expect(p.short).toBe(0);
  });
  it('호기에서 일시 제외한 줄은 채우지도 부족으로 세지도 않는다 — BOX 는 완료', () => {
    const p = fillPlan({ rows, spareByItem: { A: 10, B: 0 }, skipRows: ['r3'] });
    expect(p.short).toBe(0);
    expect(p.boxes['P/W BOX']).toBe(true);
    expect(p.lines.find((l) => l.id === 'r3')).toBeUndefined();
    const s = panelShortage(rows, { 'P/W BOX': { r1: { qty: 2 }, r3: { qty: 0, skip: true } }, 'L/D BOX': { r2: { qty: 1 } } });
    expect(s.short).toBe(0);
  });
  it('부족분 채우기 — 이미 들어온 것은 두고 모자란 만큼만 더한다', () => {
    const p = fillPlan({ rows, spareByItem: { A: 1, B: 1 }, current: { r1: 2, r2: 0, r3: 0 } });
    const r2 = p.lines.find((l) => l.id === 'r2');
    expect(r2).toMatchObject({ have: 0, add: 1, total: 1, short: 0 });
    expect(p.lines.find((l) => l.id === 'r1').add).toBe(0);
  });
  it('배정 호기들이 실제로 가져간 양을 품목별로 합친다', () => {
    const c = consumedByItem(rows, [{ 'P/W BOX': { r1: { qty: 2 }, r3: { qty: 1 }, f1: { qty: 9 } } }, { 'L/D BOX': { r2: { qty: 1 } } }]);
    expect(c).toEqual({ A: 3, B: 1 });
  });
  it('호기의 부족 줄', () => {
    const s = panelShortage(rows, { 'P/W BOX': { r1: { qty: 1 } } });
    expect(s.short).toBe(3);
    expect(s.lines[0]).toMatchObject({ id: 'r1', got: 1, short: 1 });
  });
});
