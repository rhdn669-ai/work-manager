import { useEffect, useId, useRef } from 'react';
import { lockBodyScroll, unlockBodyScroll } from './bodyScrollLock';

// 포커스를 줄 수 있는 것들 — 순서는 화면에 놓인 순서 그대로다
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ isOpen, onClose, title, children, size }) {
  // 모달 열렸을 때 배경 스크롤 잠금 — 모바일 iOS 대응 포함 (참조 카운트로 겹침 안전)
  useEffect(() => {
    if (!isOpen) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [isOpen]);

  // 바깥 클릭으로 닫을지 판정 — 마우스 누름(down)도 오버레이에서 시작했을 때만 닫는다.
  // 모달 안에서 누른 뒤(텍스트 선택 등) 밖에서 떼도 닫히지 않게 한다.
  const overlayDownRef = useRef(false);
  const boxRef = useRef(null);
  const titleId = useId();

  // ESC 로 닫기 + Tab 가두기.
  // 가두지 않으면 Tab 을 누르는 순간 포커스가 뒤 화면으로 새어 나가, 키보드로는
  // 모달이 열린 줄도 모른 채 가려진 버튼을 누르게 된다.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const box = boxRef.current;
      if (!box) return;
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // 끝에서 한 바퀴 돌린다 — 밖으로 나가는 대신 반대쪽 끝으로
      if (!e.shiftKey && (active === last || !box.contains(active))) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !box.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 열리면 모달 안 첫 요소로 포커스를 옮기고, 닫히면 열기 전 자리로 돌려준다.
  // 돌려주지 않으면 목록에서 버튼을 눌러 연 뒤 닫았을 때 포커스가 문서 맨 앞으로 튄다.
  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement;
    const box = boxRef.current;
    const items = box ? [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null) : [];
    // 닫기(×) 버튼에 먼저 꽂히면 "닫기"부터 읽히므로, 그다음 것이 있으면 그쪽을 고른다.
    // 읽기 전용 칸도 건너뛴다 — 고칠 수 없는 칸에 커서가 놓이면 할 일이 없고,
    // 거기서 Enter 를 치면 주버튼이 눌려 버린다 (2026-09-01 「마감내역 요청」 오발송).
    const target =
      items.find((el) => !el.classList.contains('modal-close') && !el.readOnly) ||
      items.find((el) => !el.classList.contains('modal-close')) ||
      items[0] ||
      box;
    target?.focus?.();
    return () => opener?.focus?.();
  }, [isOpen]);

  // Enter → 주버튼(저장) 클릭 — 전 모달 공통. textarea·IME 조합 중·비활성 버튼은 제외.
  //
  // 되돌릴 수 없는 버튼(메일 발송 등)은 data-no-enter 를 달아 이 편의에서 뺀다.
  // 저장은 다시 고치면 되지만, 나간 메일은 되돌릴 수 없다 (2026-09-01 대표님).
  const onEnterSubmit = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const t = e.target;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
    const primary = boxRef.current?.querySelector('.btn-primary:not([disabled]):not([data-no-enter])');
    if (primary) {
      e.preventDefault();
      primary.click();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        overlayDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const fromOverlay = e.target === e.currentTarget && overlayDownRef.current;
        overlayDownRef.current = false;
        if (fromOverlay) onClose?.();
      }}
    >
      <div
        ref={boxRef}
        onKeyDown={onEnterSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal${size === 'lg' ? ' modal-lg' : ''}${size === 'xl' ? ' modal-xl' : ''}`}
      >
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
