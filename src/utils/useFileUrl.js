// 사내 서버 사진·파일의 «잠시 열리는 주소» 를 받아 주는 도우미.
// 값이 서버 표시(wm-file://…)면 주소를 새로 받아 오고, 예전 구글 주소면 그대로 쓴다. (2026-09-08)
import { useEffect, useState } from 'react';
import { resolveUrl, isMarked } from '../services/serverFiles';

export function useFileUrl(value) {
  // 서버 표시가 아니면 그 값이 곧 주소다 — 그릴 때 바로 정한다(다시 그릴 일이 없다).
  const direct = value && !isMarked(value) ? value : '';
  const [signed, setSigned] = useState('');

  useEffect(() => {
    if (!value || !isMarked(value)) return () => {};
    let alive = true;
    resolveUrl(value)
      .then((u) => {
        if (alive) setSigned(u || '');
      })
      .catch(() => {
        if (alive) setSigned('');
      });
    return () => {
      alive = false;
    };
  }, [value]);

  return direct || (isMarked(value) ? signed : '');
}
