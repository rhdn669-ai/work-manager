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
    // 더 넓은 쪽으로 펼친다 — 세로 짧은 폰(아이폰SE)에서 아래가 좁으면 위로 펼쳐 다 보이게.
    const openDown = spaceBelow >= spaceAbove;
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

  // 실제 스크롤되는 조상 컨테이너를 찾는다(없으면 window).
  function getScrollParent(node) {
    let el = node?.parentElement;
    while (el) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return window;
  }

  // 드롭다운 열기 — 아래로 펼칠 공간이 부족하면 부족분만큼 페이지를 자동으로 내려
  // 옵션이 화면(하단바 위)에 다 보이게 한다. (세로 짧은 폰=아이폰SE 대응)
  function toggleOpen() {
    if (disabled) return;
    const willOpen = !open;
    setOpen(willOpen);
    if (!willOpen) return;
    requestAnimationFrame(() => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const navEl = document.querySelector('.bottom-nav');
      const headEl = document.querySelector('.header');
      const safeBottom = (navEl ? navEl.getBoundingClientRect().height : 0) + 12;
      const safeTop = (headEl ? headEl.getBoundingClientRect().height : 0) + 12;
      const desired = Math.min(320, options.length * 41 + 14);
      const spaceBelow = vh - safeBottom - r.bottom;
      const spaceAbove = r.top - safeTop;
      const openDown = spaceBelow >= spaceAbove;
      // 아래로 펼치는데 공간이 모자라면 → 부족분만큼 페이지를 내려 입력칸을 위로 올린다.
      // (위로 펼치는 경우는 위 공간이 더 넓으므로 스크롤 없이 보인다)
      if (openDown && spaceBelow < desired) {
        const need = Math.ceil(desired - spaceBelow);
        const scroller = getScrollParent(el);
        if (scroller === window) window.scrollBy({ top: need, behavior: 'smooth' });
        else scroller.scrollBy({ top: need, behavior: 'smooth' });
        // 스크롤 후 패널 위치 재계산은 scroll 리스너의 reposition이 처리
      }
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
