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
    const vw = window.innerWidth;
    const gap = 6;
    // 하단 고정바(BottomNav)·상단 고정헤더에 가려지지 않도록 사용 가능한 영역을 좁힌다.
    const navEl = typeof document !== 'undefined' ? document.querySelector('.bottom-nav') : null;
    const headEl = typeof document !== 'undefined' ? document.querySelector('.header') : null;
    const safeBottom = (navEl ? navEl.getBoundingClientRect().height : 0) + 8;
    const safeTop = (headEl ? headEl.getBoundingClientRect().height : 0) + 8;
    const spaceBelow = vh - safeBottom - r.bottom; // 입력칸 아래 사용가능 높이
    const spaceAbove = r.top - safeTop; // 입력칸 위 사용가능 높이
    const desired = Math.min(320, options.length * 41 + 14);
    // 아래 공간이 충분하거나(>=160) 위보다 넓으면 아래로, 아니면 위로 펼친다.
    const openDown = spaceBelow >= Math.min(desired, 160) || spaceBelow >= spaceAbove;
    const room = Math.max(120, openDown ? spaceBelow : spaceAbove);
    const width = Math.max(r.width, 168);
    setPos({
      left: Math.min(Math.max(8, r.left), Math.max(8, vw - width - 8)),
      width,
      top: openDown ? r.bottom + gap : undefined,
      bottom: openDown ? undefined : vh - r.top + gap,
      maxHeight: Math.min(desired, room), // 화면 안에 들어오도록 제한 → 패널 내부 스크롤
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

  // 드롭다운 열기 — 위치는 reposition이 하단바/헤더 여백을 빼고 더 넓은 쪽으로 펼쳐
  // 화면 안에 가둔다(패널 내부 스크롤). 세로 짧은 폰에서도 옵션이 항상 보인다.
  function toggleOpen() {
    if (disabled) return;
    setOpen((o) => !o);
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
