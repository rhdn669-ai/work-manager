import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/* 통일 커스텀 드롭다운 (네이티브 select 대체)
   패널을 portal(body) + position:fixed 로 띄워 모달/스크롤 컨테이너에 잘리지 않는다.
   <Select value={month} onChange={(v) => setMonth(Number(v))}
           options={months.map((m) => ({ value: m, label: `${m}월` }))} ariaLabel="월 선택" /> */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = '선택',
  className = '',
  ariaLabel,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const selected = options.find((o) => String(o.value) === String(value));

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const gap = 6;
    const spaceBelow = vh - r.bottom;
    const desired = Math.min(300, options.length * 41 + 14);
    const up = spaceBelow < desired + 12 && r.top > spaceBelow;
    const maxHeight = Math.min(300, Math.max(140, (up ? r.top : spaceBelow) - 14));
    setPos({
      left: Math.max(8, r.left),
      width: Math.max(r.width, 168),
      top: up ? undefined : r.bottom + gap,
      bottom: up ? vh - r.top + gap : undefined,
      maxHeight,
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScrollResize = () => reposition();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open, reposition]);

  function pick(v) {
    onChange(v);
    setOpen(false);
  }

  // 드롭다운을 열 때, 입력칸을 화면 중앙으로 자동 스크롤 → 화면 하단에 있어도
  // 펼쳐진 옵션이 가려지지 않고 항상 보이게 (전역 모든 Select 공통 적용).
  function toggleOpen() {
    if (disabled) return;
    setOpen((o) => {
      const next = !o;
      if (next) {
        requestAnimationFrame(() => {
          triggerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
      return next;
    });
  }

  return (
    <div className={`ds-select ${open ? 'is-open' : ''} ${className}`} ref={triggerRef}>
      <button
        type="button"
        className="ds-select__trigger"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className={`ds-select__value ${selected ? '' : 'is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevronDown" className="ds-select__caret" />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={panelRef}
            className="ds-select__panel ds-select__panel--portal"
            role="listbox"
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              minWidth: pos.width,
              maxWidth: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((o) => {
              const isSel = String(o.value) === String(value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={`ds-select__option ${isSel ? 'is-selected' : ''}`}
                    onClick={() => pick(o.value)}
                  >
                    <span>{o.label}</span>
                    {isSel && <Icon name="check" className="ds-select__check" />}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
