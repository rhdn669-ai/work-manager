import { useEffect, useCallback } from 'react';
import Icon from './Icon';

// 폴더 안 이미지들을 앱을 벗어나지 않고 넘겨보는 라이트박스.
// 이미지 클릭 → 모달로 열리고 ←/→(버튼·키보드)로 폴더 내 이미지를 순회한다.
export default function ImageLightbox({ images, index, onIndex, onClose }) {
  const total = images.length;
  const cur = images[index];

  const go = useCallback(
    (delta) => {
      const next = index + delta;
      if (next < 0 || next >= total) return;
      onIndex(next);
    },
    [index, total, onIndex],
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

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
        <img src={cur.downloadURL} alt={cur.name} />
        <figcaption className="lib-lightbox-cap">
          <span className="lib-lightbox-name" title={cur.name}>
            {cur.name}
          </span>
          <span className="lib-lightbox-count">
            {index + 1} / {total}
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
