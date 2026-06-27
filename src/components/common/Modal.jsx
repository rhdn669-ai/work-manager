import { useEffect, useRef } from 'react';

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

// 안전망 — "실제로 화면에 떠 있는 모달(.modal-overlay)이 없는데" 스크롤이 잠긴 채 남아 있으면
// 무조건 강제 해제. 카운트(openModalCount)가 어긋나 영구 잠긴 경우까지 회복한다.
// (카운트 기준이면 카운트가 새는 순간 영영 안 풀려 전 페이지 세로 스크롤이 막히던 문제 해결)
export function ensureBodyScrollUnlockedIfIdle() {
  // DOM에 실제 열린 모달 오버레이가 있으면(정상 잠금) 건드리지 않는다.
  if (typeof document !== 'undefined' && document.querySelector('.modal-overlay')) return;
  const { body, documentElement } = document;
  const wasLocked =
    body.style.overflow === 'hidden' || documentElement.style.overflow === 'hidden';
  if (wasLocked) {
    body.style.overflow = '';
    documentElement.style.overflow = '';
    if (body.style.overscrollBehavior === 'none') body.style.overscrollBehavior = '';
    savedScroll = null;
    openModalCount = 0; // 카운트도 리셋해 잔재 제거
  }
}

export default function Modal({ isOpen, onClose, title, children, size }) {
  // 모달 열렸을 때 배경 스크롤 잠금 — 모바일 iOS 대응 포함 (참조 카운트로 겹침 안전)
  useEffect(() => {
    if (!isOpen) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [isOpen]);

  // ESC 키로 닫기
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 바깥 클릭으로 닫을지 판정 — 마우스 누름(down)도 오버레이에서 시작했을 때만 닫는다.
  // 모달 안에서 누른 뒤(텍스트 선택 등) 밖에서 떼도 닫히지 않게 한다.
  const overlayDownRef = useRef(false);

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
      <div className={`modal${size === 'lg' ? ' modal-lg' : ''}${size === 'xl' ? ' modal-xl' : ''}`}>
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
