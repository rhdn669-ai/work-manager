import { describe, it, expect } from 'vitest';
import { isSubmitEnter } from '../../src/utils/enterKey';

const ev = (over = {}) => ({ key: 'Enter', shiftKey: false, target: { tagName: 'INPUT' }, nativeEvent: {}, ...over });

describe('모달 안 Enter 가 「저장」인가', () => {
  it('입력칸에서 그냥 Enter 면 저장', () => {
    expect(isSubmitEnter(ev())).toBe(true);
  });
  it('한글 조합 중(글자 확정 Enter)은 저장이 아니다 — nativeEvent 에서 읽는다', () => {
    expect(isSubmitEnter(ev({ nativeEvent: { isComposing: true } }))).toBe(false);
    expect(isSubmitEnter(ev({ keyCode: 229 }))).toBe(false);
  });
  it('Shift+Enter · 글상자 · 버튼 · 선택칸에서는 아니다', () => {
    expect(isSubmitEnter(ev({ shiftKey: true }))).toBe(false);
    expect(isSubmitEnter(ev({ target: { tagName: 'TEXTAREA' } }))).toBe(false);
    expect(isSubmitEnter(ev({ target: { tagName: 'BUTTON' } }))).toBe(false);
    expect(isSubmitEnter(ev({ target: { tagName: 'SELECT' } }))).toBe(false);
  });
  it('다른 키는 아니다', () => {
    expect(isSubmitEnter(ev({ key: 'a' }))).toBe(false);
    expect(isSubmitEnter(null)).toBe(false);
  });
});
