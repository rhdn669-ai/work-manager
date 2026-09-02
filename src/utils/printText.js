// IOPN 인쇄 양식 공용 — 긴 글자를 칸에 맞게 자동 축소
// 한글·CJK는 라틴보다 폭이 넓으므로 1.8배로 환산한 "유효 글자 수"
export function effLen(s) {
  let len = 0;
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x11ff) ||
      (c >= 0x3000 && c <= 0x9fff) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xff00 && c <= 0xffef);
    len += wide ? 1.8 : 1;
  }
  return len;
}

// 컬럼 수용 글자수(maxChars)를 넘칠 때만, 넘치는 비율만큼만 글자 축소 (CSS fs-* 클래스 반환)
export function specFontClass(s, maxChars) {
  const len = effLen(s);
  if (len <= maxChars) return ''; // 들어가면 기본 크기 유지
  const pt = 9 * (maxChars / len); // 넘치는 비율로 축소 (기본 9pt 기준)
  if (pt >= 8) return 'fs-8';
  if (pt >= 7) return 'fs-7';
  // 7pt 아래로는 줄이지 않는다 — 종이에서 읽히지 않으면 표가 아니다.
  // 더 긴 값은 글자를 더 줄이는 대신 두 줄로 접는다
  // (2026-09-02 대표님 「글이 너무 작네」 — 「헤어 스캐너 통신 케이블」이 5.5pt 였다).
  return 'fs-7 is-wrapped';
}
