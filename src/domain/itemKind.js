// BOM 줄의 갈래 — 「도급」·「사급」·「판금」 셋. (2026-09-12 대표님)
//
// 사급·도급과 마찬가지로 «담는 자리가 곧 구분»이다. BOM 의 판금 탭에 담으면 그 줄이 판금이
// 된다 (대표님 「bom에 전체,도급,사급,그리고 판금탭을 추가하고 거기서 박스 구분할거임」).
//
// 처음에는 품목 대분류에 「판금」을 표시해 두고 그 아래 품목을 모두 판금으로 보려 했는데,
// 대표님이 「품목에서는 판금안에 전부 넣고 거기서 구분할게 아니고」라고 바로잡아 주셨다.
// 같은 품목이라도 어느 BOM 줄이냐에 따라 판금일 수도 아닐 수도 있기 때문이다.
//
// 자리는 supplyType 한 칸에 담는다 — 셋 중 하나뿐이라 칸을 늘릴 까닭이 없다.
//   ''      도급 (우리가 사서 넣는 것)
//   'free'  사급 (고객사가 주는 것)
//   'made'  판금 (도면대로 만들어 넣는 것)

export const PAID = '';
export const FREE = 'free';
export const MADE_TYPE = 'made';

/** 화면에 쓰는 이름 */
export const MADE = '판금';
export const PAID_LABEL = '도급';
export const FREE_LABEL = '사급';

/** 이 줄이 판금인가 */
export function isMade(row) {
  return (row?.supplyType || '') === MADE_TYPE;
}

/** 이 줄의 갈래 — 'paid' | 'free' | 'made' */
export function kindOf(row) {
  const t = row?.supplyType || '';
  if (t === MADE_TYPE) return 'made';
  if (t === FREE) return 'free';
  return 'paid';
}

/** 화면에 쓰는 이름 */
export function kindLabel(row) {
  const k = kindOf(row);
  return k === 'made' ? MADE : k === 'free' ? FREE_LABEL : PAID_LABEL;
}

/** 누를 때마다 도급 → 사급 → 판금 → 도급 (대표님 「누를 때마다 돌아가게」) */
export function nextKind(row) {
  const t = row?.supplyType || '';
  if (t === PAID) return FREE;
  if (t === FREE) return MADE_TYPE;
  return PAID;
}

/** 탭 값(all|paid|free|made)으로 줄을 거른다 */
export function inKindTab(row, tab) {
  if (!tab || tab === 'all') return true;
  return kindOf(row) === tab;
}
