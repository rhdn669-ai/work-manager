// BOX 이름 통일 (2026-09-03 대표님 「1대1 매칭을 완벽하게」).
// 옛 이름으로 저장된 판넬을 읽을 때 새 이름으로 바꿔 읽는다 — 일괄 변환 없이.
import { describe, it, expect } from 'vitest';
import { PANEL_BOXES, BOX_OPTIONS, canonBox, renameBoxKeys, normalizeBoxKeys } from '../../src/domain/boxes';

describe('BOX 이름', () => {
  it('판넬 BOX 는 BOM 쪽 이름이다', () => {
    expect(PANEL_BOXES).toEqual(['P/W BOX', 'H/T BOX 상', 'H/T BOX 하', 'L/D BOX', 'S/D BOX', 'ROBOT', 'MP']);
  });
  it('BOM 목록에는 LOCAL·준비작업도 있다 — 실제 BOM 에 67 줄이 그 값이다', () => {
    expect(BOX_OPTIONS).toContain('LOCAL');
    expect(BOX_OPTIONS).toContain('준비작업');
  });
  it('옛 이름을 새 이름으로', () => {
    expect(canonBox('H/T상')).toBe('H/T BOX 상');
    expect(canonBox('LODER')).toBe('L/D BOX');
    expect(canonBox('S/D')).toBe('S/D BOX');
    expect(canonBox('P/W BOX')).toBe('P/W BOX');
    expect(canonBox(' H/T하 ')).toBe('H/T BOX 하');
  });
});

describe('판넬 키 정규화', () => {
  it('옛 키를 새 키로 옮긴다', () => {
    expect(renameBoxKeys({ 'H/T상': { 판금: true }, 'P/W BOX': { 판금: false } })).toEqual({
      'H/T BOX 상': { 판금: true },
      'P/W BOX': { 판금: false },
    });
  });
  it('새 키가 이미 있으면 그쪽을 지킨다 — 그게 최신이다', () => {
    expect(renameBoxKeys({ 'H/T상': 'old', 'H/T BOX 상': 'new' })).toEqual({ 'H/T BOX 상': 'new' });
  });
  it('바꿀 게 없으면 같은 객체를 돌려준다 — 불필요한 리렌더를 막는다', () => {
    const o = { 'P/W BOX': 1 };
    expect(renameBoxKeys(o)).toBe(o);
  });
  it('판넬 문서 전체 — 박스입고·부품상태·검수 안까지', () => {
    const p = {
      박스입고: { LODER: { 판금: true } },
      부품상태: { 'S/D': '완료' },
      검수: {
        공정작업자: { 'H/T하': '홍' },
        차1: { 공정비고: { 'H/T상': { 항목: [] } } },
        차2: { 공정비고: {} },
      },
    };
    const n = normalizeBoxKeys(p);
    expect(n.박스입고).toEqual({ 'L/D BOX': { 판금: true } });
    expect(n.부품상태).toEqual({ 'S/D BOX': '완료' });
    expect(n.검수.공정작업자).toEqual({ 'H/T BOX 하': '홍' });
    expect(n.검수.차1.공정비고).toEqual({ 'H/T BOX 상': { 항목: [] } });
    expect(n.검수.차2).toBe(p.검수.차2); // 손 안 댄 것은 그대로
  });
  it('이미 새 이름이면 원본 그대로', () => {
    const p = { 박스입고: { 'P/W BOX': {} }, 부품상태: { MP: '대기' } };
    expect(normalizeBoxKeys(p)).toBe(p);
  });
});
