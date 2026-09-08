// 표 상자를 화면 아래까지 늘려 «상자 안에서» 세로 스크롤하게 한다.
// 그래야 머리줄·왼쪽 열을 붙여 둘 수 있다(붙임은 스크롤 상자 기준으로만 먹는다). (2026-09-08)
import { useEffect } from 'react';

export function useFillHeight(ref, bottomGap = 12) {
  useEffect(() => {
    const el = ref.current;
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
  }, [ref, bottomGap]);
}
