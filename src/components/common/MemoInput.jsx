import { useLayoutEffect, useRef } from 'react';

// 표 안의 한 줄 메모칸 — 글이 길면 칸이 «아래로» 늘어나 다 보인다. (2026-09-15 대표님 「비고글이 짤리는데」)
//
// 한 줄 input 은 넘치는 글을 잘랐다. textarea 를 쓰되 높이를 글 길이에 맞춰 잰다(scrollHeight).
// 적는 동안에는 React 가 값을 쥐고 흔들지 않는다 — 1초마다 도는 새로고침이 한글 조합 중인
// 글자를 건드려 깨졌었다 (2026-09-14). key 에 저장된 값을 넣어 밖에서 값이 바뀔 때만 새로 그린다.
// Enter 는 줄바꿈이 아니라 「저장(칸 나가기)」 — 표 안의 다른 입력칸과 같은 손맛.
export default function MemoInput({
  value = '',
  onCommit,
  readOnly = false,
  placeholder = '메모',
  title,
  ariaLabel,
  onFocus,
}) {
  const ref = useRef(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  return (
    <textarea
      key={value}
      ref={ref}
      rows={1}
      className="pmat-input pmat-note pmat-memo"
      defaultValue={value}
      placeholder={readOnly ? '' : placeholder}
      readOnly={readOnly}
      title={title ?? value}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onInput={fit}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v === (value || '')) return;
        onCommit?.(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
