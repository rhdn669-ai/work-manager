// BOX 이름 — 생산현황 판넬과 BOM 이 «같은 이름»을 쓴다.
//
// 예전에는 판넬이 「H/T상 · LODER · S/D」, BOM 이 「H/T BOX 상 · L/D BOX · S/D BOX」로
// 따로 놀아 둘을 이을 수 없었다. BOM 쪽 이름으로 통일했다 — 인쇄물에 나가는 이름이고
// BOM 194 줄은 손대지 않아도 된다 (2026-09-03 대표님 「1대1 매칭을 완벽하게」).
//
// 판넬 데이터에 남아 있는 옛 키는 읽을 때 새 이름으로 바꿔 읽는다(normalizeBoxKeys).
// 저장은 늘 객체를 통째로 쓰므로 한 번 저장되면 옛 키는 자연히 사라진다.
// 되돌릴 수 없는 일괄 변환을 돌리지 않아도 된다.

/** 판넬 실물 BOX — 생산현황 표의 열이자 호기 자재 체크의 대상 */
export const PANEL_BOXES = ['P/W BOX', 'H/T BOX 상', 'H/T BOX 하', 'L/D BOX', 'S/D BOX', 'ROBOT', 'MP'];

/** BOM 에만 있는 구분 — 판넬 열은 아니지만 BOM 에서 고를 수 있어야 한다 */
export const EXTRA_BOXES = ['LOCAL', '준비작업'];

/** BOM 의 BOX 칸에서 고르는 목록 */
export const BOX_OPTIONS = [...PANEL_BOXES, ...EXTRA_BOXES];

/** 옛 이름 → 새 이름 */
export const LEGACY_BOX = {
  'H/T상': 'H/T BOX 상',
  'H/T하': 'H/T BOX 하',
  LODER: 'L/D BOX',
  'S/D': 'S/D BOX',
};

export function canonBox(name) {
  const k = String(name || '').trim();
  return LEGACY_BOX[k] || k;
}

/** { 옛키: v } 를 { 새키: v } 로. 새 키가 이미 있으면 그쪽이 최신이라 지킨다. */
export function renameBoxKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  let changed = false;
  const out = { ...obj };
  for (const [oldKey, newKey] of Object.entries(LEGACY_BOX)) {
    if (!(oldKey in out)) continue;
    if (!(newKey in out)) out[newKey] = out[oldKey];
    delete out[oldKey];
    changed = true;
  }
  return changed ? out : obj;
}

// 판넬 문서에서 BOX 이름을 키로 쓰는 자리
const BOX_KEYED = ['박스입고', '박스입고일자', '부품상태', '부품검수자', '출고사진', '공정작업자'];

/** 판넬 한 건의 옛 BOX 키를 전부 새 이름으로 — 읽을 때 한 번 거친다 */
export function normalizeBoxKeys(p) {
  if (!p) return p;
  let out = p;
  const set = (k, v) => {
    if (v === out[k]) return;
    if (out === p) out = { ...p };
    out[k] = v;
  };
  for (const k of BOX_KEYED) set(k, renameBoxKeys(p[k]));
  // 검수 문서 안 — 차1·차2 의 공정비고, 공정작업자
  const insp = p.검수;
  if (insp && typeof insp === 'object') {
    let ni = insp;
    const setI = (k, v) => {
      if (v === ni[k]) return;
      if (ni === insp) ni = { ...insp };
      ni[k] = v;
    };
    setI('공정작업자', renameBoxKeys(insp.공정작업자));
    for (const r of ['차1', '차2']) {
      const sec = insp[r];
      if (sec && sec.공정비고) {
        const nb = renameBoxKeys(sec.공정비고);
        if (nb !== sec.공정비고) setI(r, { ...sec, 공정비고: nb });
      }
    }
    set('검수', ni);
  }
  return out;
}
