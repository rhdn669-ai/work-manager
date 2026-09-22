// 품질 문서번호 채번 — 서식의 기본 번호 뒤에 -0001 부터 순서대로 붙인다.
//   QP-104A → QP-104A-0001, QP-104A-0002 …
//
// 세는 범위는 「양식」이 아니라 「기본 번호」다.
// 치공구·툴이 둘 다 QP-705A 를, 출하검사 실적·품질목표가 둘 다 QP-105B 를 쓰기 때문에
// 양식별로 세면 같은 번호가 두 장 생긴다.
//
// 빈 자리를 메우지 않고 항상 「가장 큰 번호 + 1」을 준다 — 지운 기록의 번호를
// 다시 쓰면 대장·성적서를 대조할 때 같은 번호의 다른 문서가 두 벌 남는다.

const PAD = 4;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function nextDocNo(prefix, usedNos) {
  if (!prefix) return ''; // 기본 번호가 없는 서식(인원 명부)은 직접 입력
  const re = new RegExp(`^${esc(prefix)}-(\\d+)$`);
  let max = 0;
  for (const no of usedNos || []) {
    const m = re.exec(String(no ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}-${String(max + 1).padStart(PAD, '0')}`;
}

// ── 날짜형 문서번호 — QP-104A-260922-0001 (2026-09-22 품질팀 요청, 대표님 결정) ──
// 그날 만든 것끼리 세고, 날이 바뀌면 0001 부터 다시. 옛 연번(QP-104A-0001)은 그대로 둔다 —
// 모양이 달라 서로 안 세고, 옛 문서는 종이로 나간 번호라 손대지 않는다.
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(d || Date.now());
  return {
    yy: String(x.getFullYear()).slice(2),
    yyyy: String(x.getFullYear()),
    mm: p2(x.getMonth() + 1),
    dd: p2(x.getDate()),
  };
};

export function nextDatedDocNo(prefix, usedNos, date) {
  if (!prefix) return '';
  const { yy, mm, dd } = ymd(date);
  const day = `${yy}${mm}${dd}`;
  const re = new RegExp(`^${esc(prefix)}-${day}-(\\d+)$`);
  let max = 0;
  for (const no of usedNos || []) {
    const m = re.exec(String(no ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}-${day}-${String(max + 1).padStart(PAD, '0')}`;
}

// ── S/NO — PROBER-20260922-000 (출하검사 실적, 2026-09-22 품질팀 요청) ──
// 설비명-제작년월일-순번. 순번은 000 부터(품질팀 「000 부터 시작」), 날이 바뀌면 다시 000.
export function nextSerialNo(prefix, usedNos, date) {
  if (!prefix) return '';
  const { yyyy, mm, dd } = ymd(date);
  const day = `${yyyy}${mm}${dd}`;
  const re = new RegExp(`^${esc(prefix)}-${day}-(\\d+)$`);
  let max = -1;
  for (const no of usedNos || []) {
    const m = re.exec(String(no ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${day}-${String(max + 1).padStart(3, '0')}`;
}
