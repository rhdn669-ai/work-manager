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
      // 떠 있는 「잠금」이 있으면 그만큼 더 줄인다 — 표 아래 스크롤바가 버튼에 가리지 않게.
      // 글자판이 서서 화면이 반으로 줄어도 상자가 짜부라지지는 않게 바닥(220px)을 둔다 —
      // 0 에 가까워지면 적는 줄을 굴려 보일 자리가 없다 (2026-09-14 태블릿).
      // 높이를 «못 넘게»만 두면 줄이 적은 BOX 에서 상자가 내용만큼 줄어, BOX 를 옮길 때마다
      // 보이는 줄 수와 표 끝선이 달라졌다. 언제나 화면 아래까지 채워 한 기준으로 맞춘다
      // (2026-09-16 대표님 「박스마다 보여주는 리스트 갯수가 다름 최대 기준으로 통일」)
      const h = `max(220px, calc(100dvh - ${Math.round(top)}px - ${bottomGap}px))`;
      el.style.maxHeight = h;
      el.style.height = h;
      // 떠 있는 「잠금」은 상자를 줄이는 대신 «안쪽 여백»으로 피한다 — 상자를 줄이면 왼쪽
      // 호기 목록보다 표가 짧아진다 (2026-09-16 대표님)
      el.style.paddingBottom = 'var(--fab-clear, 0px)';
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
