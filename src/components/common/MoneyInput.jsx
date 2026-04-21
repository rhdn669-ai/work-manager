import { useRef, useLayoutEffect } from 'react';

function formatNumber(v) {
  const n = Number(v) || 0;
  return n.toLocaleString();
}

function parseNumber(s) {
  return Number(String(s).replace(/,/g, '')) || 0;
}

export default function MoneyInput({ value, onChange, onBlur, className, disabled, placeholder }) {
  const ref = useRef(null);
  const cursorRef = useRef(null);

  // 콤마 포맷 적용된 표시값
  const display = formatNumber(value);

  // 커서 위치 복원
  useLayoutEffect(() => {
    if (cursorRef.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(cursorRef.current, cursorRef.current);
      cursorRef.current = null;
    }
  });

  function handleChange(e) {
    const input = e.target;
    const rawCursor = input.selectionStart || 0;
    const rawValue = input.value;

    // 커서 앞에 있는 콤마 개수 (변경 전)
    const commasBefore = (rawValue.slice(0, rawCursor).match(/,/g) || []).length;

    // 숫자만 추출
    const digits = rawValue.replace(/[^0-9-]/g, '');
    if (digits !== '' && digits !== '-' && !/^-?\d+$/.test(digits)) return;

    const numValue = digits === '' || digits === '-' ? 0 : Number(digits) || 0;

    // 새 포맷된 값에서 커서 위치 계산
    const newFormatted = numValue.toLocaleString();
    const digitPos = rawCursor - commasBefore; // 커서의 순수 숫자 위치
    let newCursor = 0;
    let digitCount = 0;
    for (let i = 0; i < newFormatted.length; i++) {
      if (digitCount >= digitPos) break;
      if (newFormatted[i] !== ',') digitCount++;
      newCursor = i + 1;
    }

    cursorRef.current = newCursor;
    onChange({ target: { value: String(numValue) } });
  }

  return (
    <input
      ref={ref}
      className={className}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onBlur={onBlur}
      disabled={disabled}
      placeholder={placeholder}
      style={{ textAlign: 'right' }}
    />
  );
}

export { formatNumber, parseNumber };
