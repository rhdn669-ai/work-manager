import { useEffect, useRef } from 'react';
import { lockBodyScroll, unlockBodyScroll } from './bodyScrollLock';

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
