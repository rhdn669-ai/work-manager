import { useState, useRef } from 'react';

function formatNumber(v) {
  const n = Number(v) || 0;
  return n.toLocaleString();
}

function parseNumber(s) {
  return Number(String(s).replace(/,/g, '')) || 0;
}

export default function MoneyInput({ value, onChange, onBlur, className, disabled, placeholder }) {
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);

  function handleFocus() {
    setFocused(true);
  }

  function handleBlur(e) {
    setFocused(false);
    if (onBlur) onBlur(e);
  }

  function handleChange(e) {
    const raw = e.target.value.replace(/,/g, '');
    if (raw === '' || raw === '-' || /^-?\d*$/.test(raw)) {
      onChange({ target: { value: raw } });
    }
  }

  const display = focused ? String(value || 0) : formatNumber(value);

  return (
    <input
      ref={ref}
      className={className}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      style={{ textAlign: 'right' }}
    />
  );
}

export { formatNumber, parseNumber };
