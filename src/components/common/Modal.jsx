import { useEffect } from 'react';

// ── 배경 스크롤 잠금 (참조 카운트) ──
// 모달이 겹쳐 열릴 때(모달 위에 또 다른 모달/확인창) 각자 직전 overflow 값을 저장·복원하면
// 한 모달의 복원이 다른 모달의 잠금을 덮어써 body overflow:hidden 이 영구히 남고,
// 이후 모든 페이지에서 세로 스크롤이 막히는 문제가 있었다.
// → 열린 모달 수를 세어, "첫 모달이 열릴 때만 잠그고, 마지막 모달이 닫힐 때만 푼다".
let openModalCount = 0;
let savedScroll = null;

function lockBodyScroll() {
  if (openModalCount === 0) {
    const { body, documentElement } = document;
    savedScroll = {
      bodyOverflow: body.style.overflow,
      htmlOverflow: documentElement.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
  }
  openModalCount += 1;
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0 && savedScroll) {
    const { body, documentElement } = document;
    body.style.overflow = savedScroll.bodyOverflow;
    documentElement.style.overflow = savedScroll.htmlOverflow;
    body.style.overscrollBehavior = savedScroll.bodyOverscroll;
    savedScroll = null;
  }
}

// 안전망 — 열린 모달이 없는데 스크롤이 잠긴 채 남아 있으면 강제 해제.
// (구버전에서 잠긴 세션이나 예외적 언마운트로 잔류한 잠금을 페이지 이동 시 자동 복구)
export function ensureBodyScrollUnlockedIfIdle() {
  if (openModalCount !== 0) return;
  const { body, documentElement } = document;
  if (body.style.overflow === 'hidden') body.style.overflow = '';
  if (documentElement.style.overflow === 'hidden') documentElement.style.overflow = '';
  if (body.style.overscrollBehavior === 'none') body.style.overscrollBehavior = '';
  savedScroll = null;
}

export default function Modal({ isOpen, onClose, title, children, size }) {
  // 모달 열렸을 때 배경 스크롤 잠금 — 모바일 iOS 대응 포함 (참조 카운트로 겹침 안전)
  useEffect(() => {
    if (!isOpen) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal${size === 'lg' ? ' modal-lg' : ''}${size === 'xl' ? ' modal-xl' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
