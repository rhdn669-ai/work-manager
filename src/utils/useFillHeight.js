// 표 상자를 화면 아래까지 늘려 «상자 안에서» 세로 스크롤하게 한다.
// 그래야 머리줄·왼쪽 열을 붙여 둘 수 있다(붙임은 스크롤 상자 기준으로만 먹는다). (2026-09-08)
//
// 쓰는 법: const scrollRef = useFillHeight();  →  <div ref={scrollRef}>
// (상자가 자료를 받은 뒤에야 그려지는 화면이 많아, 상자가 «생기는 순간»을 잡아야 한다.)
import { useCallback, useEffect, useRef, useState } from 'react';

export function useFillHeight(bottomGap = 12) {
  const nodeRef = useRef(null);
  const [tick, setTick] = useState(0);
  const attach = useCallback((node) => {
    nodeRef.current = node;
    setTick((v) => v + 1);
  }, []);

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return undefined;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.maxHeight = `calc(100dvh - ${Math.round(top)}px - ${bottomGap}px)`;
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    return () => {
      window.removeEventListener('resize', fit);
      ro.disconnect();
    };
  }, [tick, bottomGap]);

  return attach;
}
