// 긴 표를 다루는 두 가지 (2026-09-04 대표님)
//
// ① 높이 — 상자를 «화면 남는 만큼»으로 잘라 가로 스크롤바가 표 맨 아래가 아니라 늘 손 닿는 곳에
//    (「가로 스크롤이 밑에 있어서 화면 제일 아래로 내려야」). 머리줄은 상자 안에서 고정(CSS).
// ② 폭 — 원래 배치(폭 100%·열 %)에서 글자가 잘리는 표만 «실제 글자 폭»만큼 펼쳐 가로 스크롤.
//    브라우저의 max-content 는 입력칸을 내용과 무관하게 ≈180px 로 잡아 표를 부풀렸고(BOM 2,888px),
//    화면이 넓어도 그 폭에 고정돼 「우측이 비었는데 스크롤」이 생겼다. 잘리지 않는 표는 원래 배치 그대로
//    (「여기도 비율이 이상하네」 — 구매처 표가 넓은 화면에서 비고 칸으로 몰리던 것).
// 생산현황 표(.mx-wrap)는 자기 스크립트가 있어 건드리지 않는다.
const MIN_H = 320;
const BOTTOM_GAP = 16;
const CELL_SLACK = 6; // 칸마다 여유(px) — 글자 폭에 딱 맞추면 마지막 글자가 붙는다
// 표본 줄 수 — 3,000칸짜리 표를 전부 재면 한 번에 1초가 걸려 화면이 굳었다(2026-09-05 실측).
// 앞쪽 줄만 재도 열 폭은 거의 같다(코드·도번·규격은 길이가 고르다).
const SAMPLE_ROWS = 24;

function sampleRows(table) {
  const head = [...table.querySelectorAll('thead tr')];
  const body = table.tBodies[0] ? [...table.tBodies[0].rows].slice(0, SAMPLE_ROWS) : [];
  return head.concat(body);
}

const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

// 칸 하나에 «실제로» 필요한 폭 — 글자는 잘려 있어도 원래 폭을 재고, 입력칸은 값의 글자 폭으로
function cellNeed(td) {
  const cs = getComputedStyle(td);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  let need = 0;
  const controls = td.querySelectorAll(
    ':scope > input, :scope > select, :scope > button, :scope > .ds-select, :scope > span, :scope > div',
  );
  if (controls.length === 0) {
    // 글자 칸 — canvas 로 잰다. Range.getBoundingClientRect 는 칸마다 레이아웃을 다시 돌려
    // 3,000칸 표에서 1초 넘게 걸렸다 (2026-09-05 대표님 「반응이 느린데」)
    if (ctx) {
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      need = ctx.measureText((td.textContent || '').trim()).width;
    } else {
      need = td.scrollWidth;
    }
  } else {
    let sum = 0;
    controls.forEach((c) => {
      // 드롭다운은 칸 폭을 100% 차지해 scrollWidth 가 «지금 칸 폭»으로 되돌아온다(순환) — 고른 글자 폭으로 잰다
      const sel = c.tagName === 'SELECT' ? c : c.querySelector && c.querySelector('select');
      if (sel) {
        const f = getComputedStyle(sel);
        if (ctx) ctx.font = `${f.fontWeight} ${f.fontSize} ${f.fontFamily}`;
        const txt = sel.selectedOptions[0]?.text || '';
        sum += (ctx ? ctx.measureText(txt).width : 60) + 44; // 화살표·안쪽 여백
        return;
      }
      if (c.tagName === 'INPUT' && (c.type === 'text' || c.type === 'number')) {
        const f = getComputedStyle(c);
        if (ctx) ctx.font = `${f.fontWeight} ${f.fontSize} ${f.fontFamily}`;
        const w = ctx ? ctx.measureText(String(c.value || c.placeholder || '')).width : c.clientWidth;
        sum += w + parseFloat(f.paddingLeft) + parseFloat(f.paddingRight) + 8;
      } else if (c.tagName === 'SPAN' || c.tagName === 'DIV') {
        const inner = c.querySelector('input[type="text"], input[type="number"]');
        if (inner) {
          const f = getComputedStyle(inner);
          if (ctx) ctx.font = `${f.fontWeight} ${f.fontSize} ${f.fontFamily}`;
          const w = ctx ? ctx.measureText(String(inner.value || inner.placeholder || '')).width : inner.clientWidth;
          sum += w + parseFloat(f.paddingLeft) + parseFloat(f.paddingRight) + 8 + (c.scrollWidth - inner.clientWidth);
        } else if (c.querySelector('button, select, svg')) {
          sum += c.scrollWidth + 6; // 버튼·아이콘이 든 칸만 실측
        } else {
          const f = getComputedStyle(c);
          if (ctx) ctx.font = `${f.fontWeight} ${f.fontSize} ${f.fontFamily}`;
          sum += (ctx ? ctx.measureText((c.textContent || '').trim()).width : c.scrollWidth) + 8;
        }
      } else {
        sum += c.scrollWidth + 6;
      }
    });
    need = sum;
  }
  return need + pad + CELL_SLACK;
}

// 열마다 필요한 폭 = 그 열에서 가장 긴 칸 (colspan 칸은 건너뛴다)
function columnNeeds(table) {
  const cols = [];
  for (const tr of sampleRows(table)) {
    let ci = 0;
    for (const cell of tr.children) {
      const span = Number(cell.colSpan) || 1;
      if (span === 1) cols[ci] = Math.max(cols[ci] || 0, cellNeed(cell));
      ci += span;
    }
  }
  return cols.map((w) => Math.ceil(w || 0));
}

// 펼친 표는 열 폭을 «필요한 만큼»으로 직접 준다 — 원래 % 비율로 나누면 BOX·타입 같은 짧은 칸이
// 내용보다 훨씬 넓어져 자리를 먹는다 (2026-09-04 대표님 「태블릿에서 쓸데없이 길어서 공간을 먹는 것들」).
// colgroup 이 있으면 col 에, 없으면 머리줄 th 에. 원래 값은 data 에 두었다가 되돌린다.
function applyColumnWidths(table, needs) {
  const cols = [...table.querySelectorAll(':scope > colgroup > col')];
  const targets = cols.length ? cols : [...(table.tHead?.rows[table.tHead.rows.length - 1]?.cells || [])];
  targets.forEach((el, i) => {
    if (el.dataset.origW === undefined) el.dataset.origW = el.style.width || '';
    if (needs[i] !== undefined) el.style.width = `${needs[i]}px`;
  });
}
function restoreColumnWidths(table) {
  table.querySelectorAll('[data-orig-w]').forEach((el) => {
    el.style.width = el.dataset.origW;
  });
}

function anyCut(table) {
  for (const tr of sampleRows(table)) {
    for (const c of tr.children) {
      if (c.scrollWidth > c.clientWidth + 1) return true;
      const i = c.querySelector('input[type="text"]');
      if (i && i.scrollWidth > i.clientWidth + 1) return true;
    }
  }
  return false;
}

function fitWidth(el, table) {
  const box = el.clientWidth;
  // 같은 상자 폭·같은 열 수면 지난번 결과 그대로 — 검색으로 줄 수가 바뀌어도 다시 재지 않는다
  // (글자마다 다시 재서 검색 입력이 몇 초씩 걸렸다, 2026-09-05 실측)
  const sig = `${box}|${table.rows[0]?.cells.length || 0}`;
  if (table.dataset.fitSig === sig) return;
  table.dataset.fitSig = sig;
  // 1) 원래 배치로 돌려 잘리는지 본다 — 안 잘리면 그대로(폭 100%·열 % 유지)
  el.classList.remove('is-wide');
  restoreColumnWidths(table);
  table.style.width = '';
  if (!anyCut(table)) return;
  // 2) 잘리면 열마다 «실제 글자 폭»을 주고 그 합만큼 펼친다 — 화면보다 좁으면 화면 폭(스크롤 없음)
  el.classList.add('is-wide');
  const needs = columnNeeds(table);
  applyColumnWidths(table, needs);
  const need = needs.reduce((a, b) => a + b, 0);
  table.style.width = `${Math.max(box, need)}px`;
}

export function fitTables() {
  if (typeof window === 'undefined') return;
  if (window.innerWidth < 769) return; // 폰은 카드형·페이지 스크롤
  document.querySelectorAll('.table-scroll-x').forEach((el) => {
    if (el.classList.contains('mx-wrap')) return;
    const table = el.querySelector(':scope > table');
    // 열 폭을 스스로 정한 표(.no-fit)는 «폭»만 건너뛴다 — 높이(내부 스크롤)는 다른 표와 같게
    // (2026-09-05 대표님 「사급 도급 리스트 사이즈가 다름」·「스크롤 규칙 이상」)
    const noFit = !!table && table.classList.contains('no-fit');
    if (!table || !table.tBodies[0] || table.tBodies[0].rows.length === 0) return;
    if (!noFit) fitWidth(el, table);
    const top = el.getBoundingClientRect().top;
    const avail = Math.round(window.innerHeight - top - BOTTOM_GAP);
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
  // body 전체를 지켜보던 ResizeObserver 는 뗐다 — 글자 하나 바뀌어 높이가 달라져도 표 전체를 다시 쟀다.
  // 창 크기 변화(디바운스)와 표 «자체» 크기 변화(줄이 늘거나 줄 때)에만 돈다.
  let timer = 0;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(fitTables, 300);
  };
  window.addEventListener('resize', run);
  const ro = new ResizeObserver((entries) => {
    // 우리가 폭을 바꾼 결과로 다시 불리는 것은 fitSig 가 걸러 준다
    if (entries.length) run();
  });
  const watched = new WeakSet();
  const watch = () => {
    document.querySelectorAll('.table-scroll-x > table').forEach((t) => {
      if (watched.has(t)) return;
      watched.add(t);
      ro.observe(t);
    });
  };
  // 화면 전환·데이터 도착으로 새 표가 생기면 감시 대상에 넣는다 (가볍게 1초마다)
  const scan = setInterval(watch, 1000);
  watch();
  run();
  return () => {
    window.removeEventListener('resize', run);
    ro.disconnect();
    clearInterval(scan);
    clearTimeout(timer);
  };
}
