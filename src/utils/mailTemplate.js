// 업체로 나가는 메일의 기본 틀 — 발주서·메일 발송·마감내역 요청이 함께 쓴다.
//
// 세 곳이 제각각이었다. 발주서만 수신 줄과 명함이 있고, 메일 발송은 발신 줄뿐이고,
// 마감내역 요청은 글자 서명을 따로 달고 있었다. 같은 회사에서 나가는 메일이 서로 다른
// 얼굴이면 받는 업체가 헷갈린다 — 검증된 발주서 양식을 표준으로 뽑았다 (2026-08-27 대표님).
//
//   발신 : (주)아이오피엔
//   수신 : ○○○
//   (빈 줄)
//   본문
//   (빈 줄)
//   [담당자 명함]
//
// 서명은 명함 하나로 끝낸다. 명함 이미지에 이름·직책·전화·메일이 다 있어
// 글자 서명까지 넣으면 같은 말이 두 번 나온다.

// 명함이 있는 사람 — public/cards/{이름}.png
export const BUSINESS_CARD_NAMES = [
  '이주현',
  '박정현',
  '라혜림',
  '하성민',
  '이종현',
  '이종나',
  '하혜정',
  '이승빈',
  '손성욱',
];

export function cardFileFor(name) {
  const n = (name || '').trim();
  return BUSINESS_CARD_NAMES.includes(n) ? `/cards/${encodeURIComponent(n)}.png` : '';
}

// 사용자가 친 글을 HTML 로 — 태그로 읽히지 않게 막고 줄바꿈만 살린다
export function escapeBody(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * 메일 본문 HTML 을 만든다.
 * @param {object} o
 * @param {string} o.to        수신처 이름 (업체명). 비우면 수신 줄을 넣지 않는다.
 * @param {string} o.body      본문 글 (일반 텍스트 — 안에서 escape 한다)
 * @param {string} o.bodyHtml  이미 HTML 인 본문 (표 등). body 보다 우선한다.
 * @param {string} o.cardName  명함을 붙일 사람 이름. 명단에 없으면 명함 없이 나간다.
 * @returns {string} 발송·미리보기에 그대로 쓰는 HTML
 */
export function buildMailHtml({ to, body, bodyHtml, cardName } = {}) {
  const head = [
    '<p style="margin:0 0 4px;font-weight:700">발신 : (주)아이오피엔</p>',
    to ? `<p style="margin:0 0 14px;font-weight:700">수신 : ${escapeBody(to)}</p>` : '',
    '<br><br>',
  ].join('');

  const inner = bodyHtml || `<p>${escapeBody(body)}</p>`;

  const card = cardFileFor(cardName);
  const tail = card
    ? `<br><br><br><img src="${card}" alt="담당자 명함" width="220" style="width:220px;max-width:100%;border:1px solid #eee" />`
    : '';

  return `${head}${inner}${tail}`;
}

// 제목 접두 — 업체 메일함에서 우리 것을 골라내기 쉽게 한 벌로 붙인다
export function mailSubject(text) {
  const t = String(text || '').trim();
  return t.startsWith('[주식회사 아이오피엔]') ? t : `[주식회사 아이오피엔] ${t}`;
}

// 「주식회사 아이오피엔 ○○○입니다.」 — 명함을 고른 사람 이름을 넣는다.
//
// 명함 명단에 있는 이름만 쓴다. 계정 이름이 「IOPN」 같은 회사 계정일 때
// 「아이오피엔 IOPN입니다」로 나가 버리기 때문이다 (2026-08-27 대표님).
// 명함이 없으면 이름도 없다 — 이름과 명함이 따로 놀면 받는 쪽이 헷갈린다.
export function senderLine(name) {
  const n = String(name || '').trim();
  return BUSINESS_CARD_NAMES.includes(n) ? `주식회사 아이오피엔 ${n}입니다.` : '주식회사 아이오피엔입니다.';
}
