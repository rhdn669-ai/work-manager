// 품목의 큰 갈래 — 「전장자재」인가 「가공품」인가. (2026-09-12 대표님)
//
// 전장자재는 사서 넣는 부품이고, 가공품은 도면대로 깎아 만드는 물건이다. 두 갈래는 보는
// 사람도 다루는 방식도 달라 화면에서 갈라 보여야 한다.
//
// 갈래는 «품목 대분류»에 한 번만 적어 둔다. 품목 하나하나에 적게 하면 새 품목을 넣을 때마다
// 빠뜨리기 쉽다 — 대분류(IOPN-047 같은 것)에 「가공품」이라고 표시해 두면 그 아래 품목은
// 저절로 가공품이 된다 (대표님 「내가 품목에 추가하고 알아서 넣을게 연동만 잘되게해줘」).
//
// 사급·도급과는 다른 축이다. 가공품도 회사에 따라 사급일 수도 도급일 수도 있다
// (대표님 「갈림」).

export const MADE = '가공품';
export const ELEC = '전장자재';

/** 품목 코드에서 대분류 코드만 — IOPN-014-19 → IOPN-014 */
export function mainCodeOf(code) {
  const m = String(code || '').match(/^([A-Za-z]+-\d+)/);
  return m ? m[1] : '';
}

/** 그 품목이 대분류(하위가 없는 머리 품목)인가 — IOPN-014 처럼 끝에 소분류가 없다 */
export function isMainItem(item) {
  return /^[A-Za-z]+-\d+$/.test(String(item?.code || ''));
}

/**
 * 「가공품」으로 표시된 대분류 코드들 — 품목 목록에서 한 번 뽑아 두고 돌려 쓴다.
 * @param {Array} items 품목 마스터 전체
 * @returns {Set<string>} 예: Set { 'IOPN-047' }
 */
export function madeMainCodes(items) {
  const out = new Set();
  for (const it of items || []) {
    if ((it?.kind || '') === MADE) out.add(mainCodeOf(it.code) || String(it.code || ''));
  }
  out.delete('');
  return out;
}

/**
 * 이 품목(또는 BOM 줄)이 가공품인가.
 * 줄에 직접 적힌 kind 가 있으면 그것을 먼저 본다 — 대분류와 다르게 두고 싶을 때를 위해서다.
 * @param {object} row  { kind?, code? } 또는 품목
 * @param {Set<string>} madeMains madeMainCodes(items)
 */
export function isMade(row, madeMains) {
  if ((row?.kind || '') === MADE) return true;
  if ((row?.kind || '') === ELEC) return false;
  if (!madeMains || madeMains.size === 0) return false;
  return madeMains.has(mainCodeOf(row?.code));
}

/** 화면에 쓰는 이름 */
export function kindLabel(row, madeMains) {
  return isMade(row, madeMains) ? MADE : ELEC;
}
