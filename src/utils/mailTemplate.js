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

// 명함이 있는 사람.
//
// 원래는 이 목록이 전부였다 — public/cards 에 파일을 넣고 여기에 이름을 박았다.
// 사람이 들어오거나 명함을 바꿀 때마다 개발자가 다시 배포해야 했다.
// 이제 자료실 「명함」 폴더가 먼저다. 이 목록은 아직 안 올린 사람을 위한 대비책으로 남긴다
// (2026-08-27 대표님 「명함을 불러오기가 아니라 자료실에서 가져오는게 낫지않음?」).
export const BUILTIN_CARD_NAMES = [
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

// 자료실에서 읽어 둔 명함 — { 이름: 내려받기주소 }. 앱이 뜰 때 한 번 채운다.
let libraryCards = {};

export function setLibraryCards(map) {
  libraryCards = map || {};
}

// 자료실에 있는 사람 + 아직 안 올린 붙박이 — 둘을 합친 것이 「고를 수 있는 명함」
export function cardNames() {
  return [...new Set([...Object.keys(libraryCards), ...BUILTIN_CARD_NAMES])].sort((a, b) => a.localeCompare(b, 'ko'));
}

// 인라인 첨부 식별자 — 본문의 cid: 와 첨부의 cid 가 같아야 이어진다
export const CARD_CID = 'bizcard';

export function cardFileFor(name) {
  const n = (name || '').trim();
  if (libraryCards[n]) return libraryCards[n]; // 자료실이 먼저
  return BUILTIN_CARD_NAMES.includes(n) ? `/cards/${encodeURIComponent(n)}.png` : '';
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
 * @param {boolean} o.preview  화면 미리보기용. 명함을 파일 경로로 가리킨다(브라우저는 cid: 를 모른다).
 * @returns {string} 발송·미리보기에 그대로 쓰는 HTML
 */
export function buildMailHtml({ to, body, bodyHtml, cardName, preview = false } = {}) {
  const head = [
    '<p style="margin:0 0 4px;font-weight:700">발신 : (주)아이오피엔</p>',
    to ? `<p style="margin:0 0 14px;font-weight:700">수신 : ${escapeBody(to)}</p>` : '',
    '<br><br>',
  ].join('');

  const inner = bodyHtml || `<p>${escapeBody(body)}</p>`;

  // 명함 그림이 가리키는 곳이 보낼 때와 볼 때 다르다.
  //
  //   보낼 때  cid:bizcard  — 첨부로 실어 보낸다. 상대 경로는 받는 쪽 메일함에서 깨지고,
  //                          절대 주소는 대부분의 메일함이 외부 이미지를 기본 차단한다.
  //   볼 때    /cards/이름.png — 브라우저는 cid: 를 모른다. 미리보기가 깨져 버린다.
  //
  // (2026-08-27 대표님 「명함이 깨져서 나감」 → 미리보기도 깨짐)
  const cardSrc = cardFileFor(cardName);
  const tail = cardSrc
    ? `<br><br><br><img src="${preview ? cardSrc : `cid:${CARD_CID}`}" alt="담당자 명함" width="220" style="width:220px;max-width:100%;border:1px solid #eee" />`
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
  return cardFileFor(n) ? `주식회사 아이오피엔 ${n}입니다.` : '주식회사 아이오피엔입니다.';
}

// 명함을 첨부 형태로 — 발송 직전에 부른다. 명함이 없으면 빈 배열이라 그대로 이어붙이면 된다.
export async function cardAttachment(cardName) {
  const src = cardFileFor(cardName);
  if (!src) return [];
  try {
    const res = await fetch(src);
    if (!res.ok) return [];
    const buf = await res.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return [
      {
        filename: `${cardName}.png`,
        content: btoa(bin),
        encoding: 'base64',
        contentType: res.headers.get('content-type') || 'image/png',
        cid: CARD_CID,
        contentDisposition: 'inline',
      },
    ];
  } catch {
    return []; // 명함을 못 읽어도 메일은 나가야 한다
  }
}

// ── 답장 추적 번호 ─────────────────────────────────────────────
// 업체가 「답장」을 누르면 이 번호가 그 메일의 In-Reply-To 에 그대로 담겨 온다.
// 제목을 고쳐도, 본문을 다 지워도 어느 건의 답장인지 알 수 있다
// (2026-08-28 대표님 「메일 헤더에」).
//
// 번호 자체에는 뜻을 담지 않는다 — 업체명이 한글이라 헤더에 그대로 못 넣고,
// 발주 번호가 겉으로 드러나는 것도 좋지 않다. 무엇에 대한 메일인지는
// 이 번호로 mailThreads 에서 찾는다.
//
// 도메인은 보내는 주소와 맞춘다. 엉뚱한 도메인을 쓰면 스팸으로 몰릴 수 있다.
const MSGID_DOMAIN = 'naver.com';

export function newMessageId() {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `<wm-${Date.now().toString(36)}-${rand}@${MSGID_DOMAIN}>`;
}

// 답장의 In-Reply-To 에서 우리 번호만 골라낸다. 우리가 보낸 것이 아니면 빈 값.
export function threadKeyOf(messageId) {
  const m = String(messageId || '').match(/<(wm-[A-Za-z0-9-]+)@/);
  return m ? m[1] : '';
}
