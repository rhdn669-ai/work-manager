// 엑셀에서 한 열을 복사해 표에 세로로 붙여넣기.
//
// 엑셀은 셀을 세로로 긁으면 줄바꿈으로, 가로로 긁으면 탭으로 이어 붙여 준다.
// 여기서는 세로 한 줄만 다루므로, 각 줄의 첫 칸만 쓰고 나머지 탭 뒤는 버린다.
//
// 날짜는 사람이 쓰는 만큼 형태가 제각각이다 — 2026-07-21 · 2026. 7. 21 · 2026/7/21 · 7/21.
// 연도가 없으면 기준 연도(보통 오늘)를 붙인다.

export function splitPasted(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.split('\t')[0].trim())
    .filter((line, i, arr) => !(line === '' && i === arr.length - 1)); // 엑셀이 끝에 붙이는 빈 줄만 버린다
}

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' 로 맞춘다. 날짜로 못 읽으면 null.
export function toISODate(raw, baseYear) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const year = baseYear || new Date().getFullYear();

  // 2026-07-21 · 2026.07.21 · 2026/7/21 · 2026. 7. 21.
  let m = /^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;

  // 7/21 · 7-21 · 7.21 — 연도가 없으면 기준 연도를 붙인다
  m = /^(\d{1,2})[.\-/](\d{1,2})\.?$/.exec(s);
  if (m) return `${year}-${pad(m[1])}-${pad(m[2])}`;

  // 20260721
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

// 붙여넣은 줄들을 그 열의 값으로 바꾼다.
//   date 열이면 날짜로 읽고, 못 읽은 줄은 건너뛴다(빈 줄은 '지우기'로 본다).
// 반환: [{ index, value }] — index 는 시작 행부터의 거리
export function mapPastedValues(lines, { type = 'text', baseYear } = {}) {
  const out = [];
  lines.forEach((raw, i) => {
    if (type !== 'date') {
      out.push({ index: i, value: raw });
      return;
    }
    const v = toISODate(raw, baseYear);
    if (v === null) return; // 날짜가 아닌 줄(머리글 등)은 조용히 건너뛴다
    out.push({ index: i, value: v });
  });
  return out;
}
