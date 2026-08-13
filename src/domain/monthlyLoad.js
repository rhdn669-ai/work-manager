// 월별 대수 — "이번 달에 몇 대 나가나"를 세는 규칙.
//
// 기준이 되는 날짜가 회사마다 다르다 (2026-08-12 대표님):
//   · 메티스   → 출하일
//   · 디에이치 → I/O CHECK 일
// 같은 판넬이라도 어느 회사 것이냐에 따라 세는 날이 달라지므로, 기준을 여기 한 곳에 둔다.
//
// 달을 가르는 선은 말일이 아니라 25일이다. 26일부터는 다음 달로 넘어간다 —
// 9/26 에 나가는 판넬은 10월 몫으로 잡힌다.

export const MONTH_BASIS = { 메티스: '출하', 디에이치: 'ioCheck' };

export const CUT_DAY = 25;

export function basisField(company) {
  return MONTH_BASIS[company] || '출하';
}

// 'YYYY-MM-DD' → 'YYYY-MM' (25일 마감 적용). 날짜가 없거나 형식이 틀리면 null.
export function cutoffMonth(dateStr, cutDay = CUT_DAY) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const d = Number(m[3]);
  let [y, mo] = [Number(m[1]), Number(m[2])];
  if (d > cutDay) {
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

// 판넬 목록 → [{ month: '2026-09', count: 5 }] (월 오름차순)
// 회사를 주면 그 회사 것만, 안 주면 각 판넬의 회사에 맞는 기준으로 센다.
export function monthlyCounts(panels, company) {
  const acc = new Map();
  for (const p of panels || []) {
    if (company && (p?.회사 || '') !== company) continue;
    const key = cutoffMonth(p?.[basisField(p?.회사 || company)]);
    if (!key) continue;
    acc.set(key, (acc.get(key) || 0) + 1);
  }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count }));
}

// '2026-09' → '9월'
export function monthLabel(key) {
  const m = /^\d{4}-(\d{2})$/.exec(String(key || ''));
  return m ? `${Number(m[1])}월` : '';
}
