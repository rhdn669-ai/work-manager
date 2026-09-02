// 붙여넣은 목록 한 줄을 품목 하나로 알아보는 일.
//
// 대표님은 엑셀에서 「도번 <탭> 수량」을 그대로 긁어 온다:
//     3501-001593	1EA
//     3704-001262	2EA
// 그래서 코드뿐 아니라 도번으로도 찾아야 하고, 수량의 「EA」 같은 꼬리말도 읽어야 한다
// (2026-09-02 대표님 「코드 추가 도번, 수량 순서로 넣어도 인식 가능하게」).
//
// 다른 품목이 잘못 붙으면 엉뚱한 자재를 발주하게 되므로 「부분 포함」은 하지 않는다.
// 띄어쓰기·하이픈 차이 정도만 무시한 완전 일치까지만 받는다.

const norm = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/^["']+|["']+$/g, '');

// 느슨한 정규화: 공백·하이픈·쉼표·괄호만 제거 (그 외 문자는 보존 → 다른 품목과 섞이지 않음)
const loose = (v) => norm(v).replace(/[\s,()-]+/g, '');

// 찾는 차례: 코드 → 도번 → 품명 → 규격.
// 도번이 코드보다 뒤인 것은, 둘이 겹칠 때 코드가 원본이기 때문이다.
const FIELDS = ['code', 'drawingNo', 'name', 'spec'];

/** 한 토큰으로 품목 하나를 찾는다. 못 찾으면 null. */
export function findMasterByToken(itemMaster, token) {
  const list = itemMaster || [];
  const t = norm(token);
  if (!t) return null;

  const exact = (v) => {
    for (const f of FIELDS) {
      const hit = list.find((m) => norm(m[f]) === v);
      if (hit) return hit;
    }
    return null;
  };

  // 1차: 정확 일치
  let hit = exact(t);
  if (hit) return hit;

  // 2차: 괄호/뒤 메모 제거한 핵심 토큰으로 재시도
  const base = t.split('(')[0].trim();
  if (base && base !== t) {
    hit = exact(base);
    if (hit) return hit;
  }

  // 3차: 띄어쓰기·하이픈 차이만 무시한 완전 일치 (부분 일치 아님)
  const lt = loose(base || t);
  if (lt) {
    for (const f of FIELDS) {
      hit = list.find((m) => loose(m[f]) === lt);
      if (hit) return hit;
    }
  }
  return null;
}

// 수량 꼬리말 — 「1EA」·「2 개」·「3 PCS」처럼 숫자 뒤에 단위가 붙어 온다.
// 코드 끝 숫자(SS-130, 4797.0015)는 앞에 공백이 없어 수량으로 오인식되지 않는다.
const QTY_TAIL = /[\s\t]+(\d+(?:\.\d+)?)\s*(?:ea|pcs|pc|set|개|EA|PCS|PC|SET)?\s*$/i;

/**
 * 한 줄을 「찾을 토큰」과 「수량」으로 가른다.
 * 수량이 없으면 0 — 부르는 쪽에서 1 로 본다.
 */
export function splitQty(line) {
  const raw = String(line || '').trim();
  if (!raw) return { token: '', qty: 0 };
  const m = raw.match(QTY_TAIL);
  if (!m) return { token: raw, qty: 0 };
  return { token: raw.slice(0, m.index).trim(), qty: Number(m[1]) || 0 };
}
