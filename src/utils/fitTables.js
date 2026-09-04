// 긴 표의 상자 높이를 «화면 남는 만큼»으로 맞춘다 — 가로 스크롤바가 표 맨 아래가 아니라 늘 손 닿는 곳에
// (2026-09-04 대표님 「가로 스크롤이 밑에 있어서 화면 제일 아래로 내려야 이동이 가능해짐」).
// CSS 의 calc(100dvh - N) 은 위쪽에 배너·제목·필터가 얼마나 있는지 몰라 어긋난다. 실제 위치로 잰다.
// 생산현황 표(.mx-wrap)는 자기 스크립트가 있어 건드리지 않는다.
const MIN_H = 320;
const BOTTOM_GAP = 16;
// 내용 폭으로 펼친 표가 너무 넓어 보여 20% 줄인다 (2026-09-04 대표님 「전체 폭을 일정한 비율로 20%」).
// 화면 폭보다 좁아지진 않는다. 줄여서 잘리는 칸은 말줄임(title 로 전체 확인).
const SHRINK = 0.82; // 84% 에서 2% 내림 (2026-09-04 대표님 「2프로 축소」)

function shrinkWide(el, table) {
  const box = el.clientWidth;
  table.style.width = ''; // 자연 폭(max-content)을 재려고 잠시 푼다
  const natural = table.scrollWidth;
  if (natural <= box + 1) return; // 화면 안에 다 들어오면 그대로
  table.style.width = `${Math.max(box, Math.round(natural * SHRINK))}px`;
}

export function fitTables() {
  if (typeof window === 'undefined') return;
  if (window.innerWidth < 769) return; // 폰은 카드형·페이지 스크롤
  const boxes = document.querySelectorAll('.table-scroll-x');
  boxes.forEach((el) => {
    if (el.classList.contains('mx-wrap')) return;
    const table = el.querySelector(':scope > table');
    if (!table) return;
    shrinkWide(el, table);
    const top = el.getBoundingClientRect().top + window.scrollY; // 문서 기준 위치
    // 상자가 화면 위쪽 한 화면 안에서 시작할 때만 자른다 — 아래쪽 어딘가의 작은 표는 그대로
    const avail = Math.round(window.innerHeight - (top - window.scrollY) - BOTTOM_GAP);
    if (table.offsetHeight <= avail || avail < MIN_H) {
      el.style.maxHeight = '';
      return;
    }
    el.style.maxHeight = `${Math.max(MIN_H, avail)}px`;
  });
}

/** 앱 껍데기에서 한 번 부른다 — 창 크기·배너 열림닫힘·화면 전환마다 다시 맞춘다 */
export function installFitTables() {
  if (typeof window === 'undefined') return () => {};
  let raf = 0;
  const run = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fitTables();
    });
  };
  window.addEventListener('resize', run);
  const ro = new ResizeObserver(run);
  ro.observe(document.body);
  run();
  return () => {
    window.removeEventListener('resize', run);
    ro.disconnect();
    if (raf) cancelAnimationFrame(raf);
  };
}
