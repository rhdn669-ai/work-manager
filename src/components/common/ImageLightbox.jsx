import { useEffect, useCallback, useState, useRef } from 'react';
import Icon from './Icon';

// 폴더 안 이미지들을 앱을 벗어나지 않고 넘겨보는 라이트박스.
// 이미지 클릭 → 모달로 열리고 ←/→(버튼·키보드)로 폴더 내 이미지를 순회한다.
export default function ImageLightbox({ images, index, onIndex, onClose }) {
  const total = images.length;
  const cur = images[index];

  // 확대·이동 — 불량 부위를 들여다봐야 하므로 화면에 맞추기만 해서는 부족하다.
  // 휠(또는 손가락 오므리기)로 키우고, 키운 상태에서 끌어 옮긴다. 더블클릭으로 2배↔원래.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const go = useCallback(
    (delta) => {
      const next = index + delta;
      if (next < 0 || next >= total) return;
      reset(); // 다음 사진은 처음 크기부터
      onIndex(next);
    },
    [index, total, onIndex, reset],
  );

  function zoomBy(factor, keepCenter = true) {
    setZoom((z) => {
      const next = Math.min(6, Math.max(1, z * factor));
      if (next === 1 && keepCenter) setPan({ x: 0, y: 0 }); // 원래 크기로 돌아오면 위치도 가운데로
      return next;
    });
  }

  function onWheel(e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function onPointerDown(e) {
    if (zoom <= 1) return; // 원래 크기에서는 끌 것이 없다
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-') zoomBy(1 / 1.25);
      else if (e.key === '0') reset();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, reset]);

  // 인접 이미지(±2)를 미리 받아둔다 → 화살표 누르는 즉시 캐시에서 표시(넘김 지연 제거)
  useEffect(() => {
    for (let d = -2; d <= 2; d++) {
      const i = index + d;
      if (i < 0 || i >= total || d === 0) continue;
      const url = images[i]?.downloadURL;
      if (url) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [index, total, images]);

  if (!cur) return null;

  return (
    <div className="lib-lightbox" role="dialog" aria-modal="true" aria-label="이미지 뷰어" onClick={onClose}>
      <button type="button" className="lib-lightbox-close" onClick={onClose} aria-label="닫기">
        <Icon name="close" />
      </button>

      {index > 0 && (
        <button
          type="button"
          className="lib-lightbox-nav is-prev"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="이전 이미지"
        >
          <Icon name="chevronLeft" />
        </button>
      )}

      <figure className="lib-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <div className="lib-lightbox-view" onWheel={onWheel} onDoubleClick={() => (zoom > 1 ? reset() : zoomBy(2))}>
          <img
            loading="lazy"
            src={cur.downloadURL}
            alt={cur.name}
            className={zoom > 1 ? 'is-zoomed' : undefined}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <figcaption className="lib-lightbox-cap">
          <span className="lib-lightbox-name" title={cur.name}>
            {cur.name}
          </span>
          <span className="lib-lightbox-count">
            {index + 1} / {total}
          </span>
          <span className="lib-lightbox-zoom">
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="축소" disabled={zoom <= 1}>
              −
            </button>
            <button type="button" onClick={reset} aria-label="원래 크기">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="확대" disabled={zoom >= 6}>
              +
            </button>
          </span>
          <a
            className="lib-lightbox-dl"
            href={cur.downloadURL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="원본 열기"
          >
            <Icon name="download" />
          </a>
        </figcaption>
      </figure>

      {index < total - 1 && (
        <button
          type="button"
          className="lib-lightbox-nav is-next"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="다음 이미지"
        >
          <Icon name="chevronRight" />
        </button>
      )}
    </div>
  );
}
