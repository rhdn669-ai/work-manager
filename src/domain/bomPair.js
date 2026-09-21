// 짝 BOM — 프로버 (메티스)와 프로버 (디에이치)처럼 «같은 판넬, 고객사만 다른» BOM 둘을 묶어
// 한쪽을 고치면 다른 쪽도 같이 바뀌게 한다.
//
// 전에는 「다름 찾기」로 한 줄씩 손으로 맞췄다. 오늘 메티스에서 Relay 를 LOCAL → ROBOT 으로
// 옮겼는데 디에이치는 LOCAL 그대로 남는 식으로, 바꿀 때마다 두 번 손이 갔다
// (2026-09-18 대표님 「매번 이렇게 맞추는거보다 두개 어느 범위까지 연동할지 선택목록을 두고 연동되게」).
//
// 늘 같이 가는 것: 품목 연결·품명·규격·단위·도번·비고·단가·줄 순서·줄 추가/삭제.
// 고를 수 있는 것: 수량·BOX·타입·구분 — 구분(도급/사급)은 고객사마다 달라 기본은 끔
// (2026-09-18 대표님 「도번, 줄 추가삭제, 비고, 줄순서, 단가는 같은걸로 하고 목록에 아예 안넣어줘도 됨」).
import { mapVariantKeys } from './bomDiff';

export const PAIR_OPTIONS = [
  { key: 'qty', label: '수량' },
  { key: 'box', label: 'BOX' },
  { key: 'variant', label: '타입' },
  { key: 'supplyType', label: '구분 (도급 / 사급)' },
];
export const PAIR_DEFAULT = { qty: true, box: true, variant: true, supplyType: false };

/** 늘 같이 가는 칸 — 고를 수 없다 */
export const ALWAYS_FIELDS = ['itemId', 'name', 'spec', 'unit', 'drawingNo', 'note', 'unitPrice', 'dirs'];

const labelsOf = (keys, variants) => {
  const byKey = new Map((variants || []).map((v) => [v.key, String(v.label || '').trim()]));
  return (keys || [])
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .sort()
    .join('+');
};

/** 「같은 줄」을 알아보는 열쇠 — 품목 × BOX × 타입(이름). 타입 열쇠는 프로젝트마다 달라 이름으로 견준다 */
export function rowKey(row, variants) {
  const item = String(row?.itemId || '').trim() || `${row?.name || ''}|${row?.spec || ''}`;
  return `${item}::${row?.box || ''}::${labelsOf(row?.variantKeys, variants)}`;
}

/** 상대 BOM 에서 이 줄의 짝을 찾는다 — 없으면 null */
export function twinOf(row, myVariants, theirRows, theirVariants) {
  const k = rowKey(row, myVariants);
  return (theirRows || []).find((r) => rowKey(r, theirVariants) === k) || null;
}

/**
 * 내 줄에 적용한 고침(data)을 짝 줄에 옮길 고침으로 바꾼다.
 * 늘 같이 가는 칸은 그대로, 고를 수 있는 칸은 sync 에 켜진 것만. 타입은 이름으로 다시 짝짓는다.
 * 옮길 것이 없으면 null.
 */
/** { [내 타입 열쇠]: 수량 } → { [상대 타입 열쇠]: 수량 } — 이름이 같은 타입끼리 짝짓는다 */
export function mapVariantQty(byVariant, fromVariants, toVariants) {
  const src = byVariant && typeof byVariant === 'object' && !Array.isArray(byVariant) ? byVariant : {};
  const out = {};
  for (const k of Object.keys(src)) {
    const [mapped] = mapVariantKeys([k], fromVariants, toVariants);
    if (mapped) out[mapped] = Math.max(0, Number(src[k]) || 0);
  }
  return out;
}

export function pairPatch(data, sync, myVariants, theirVariants) {
  const s = { ...PAIR_DEFAULT, ...(sync || {}) };
  const out = {};
  for (const f of ALWAYS_FIELDS) if (f in (data || {})) out[f] = data[f];
  if (s.qty && 'qty' in data) out.qty = Number(data.qty) || 0;
  // 타입별 수량 — 열쇠가 프로젝트마다 달라 이름으로 옮긴다. 상대에 없는 타입 값은 버린다
  if (s.qty && s.variant && 'qtyByVariant' in data)
    out.qtyByVariant = mapVariantQty(data.qtyByVariant, myVariants, theirVariants);
  if (s.box && 'box' in data) out.box = data.box || '';
  if (s.supplyType && 'supplyType' in data) out.supplyType = data.supplyType || '';
  if (s.variant && 'variantKeys' in data)
    out.variantKeys = mapVariantKeys(
      Array.isArray(data.variantKeys) ? data.variantKeys : [],
      myVariants,
      theirVariants,
    );
  return Object.keys(out).length ? out : null;
}

/**
 * 내 BOM 에 새로 넣은 줄을 짝 BOM 에 넣을 모양으로.
 * 구분을 같이 안 가면(기본) 상대 BOM 에 같은 품목이 있을 때 그 줄의 구분을 따르고, 없으면 빈칸(도급).
 */
export function pairCopy(data, sync, myVariants, theirVariants, theirRows) {
  const s = { ...PAIR_DEFAULT, ...(sync || {}) };
  const id = String(data?.itemId || '').trim();
  const like = id ? (theirRows || []).find((r) => String(r.itemId || '').trim() === id) : null;
  return {
    itemId: data.itemId || '',
    name: data.name || '',
    spec: data.spec || '',
    unit: data.unit || '',
    drawingNo: data.drawingNo || '',
    note: data.note || '',
    unitPrice: Number(data.unitPrice) || 0,
    dirs: Array.isArray(data.dirs) ? data.dirs : [], // 정·역은 같은 판넬의 성질이라 늘 같이 간다
    order: Number(data.order) || 0,
    qty: s.qty ? Number(data.qty) || 0 : 0,
    box: s.box ? data.box || '' : '',
    supplyType: s.supplyType ? data.supplyType || '' : like?.supplyType || '',
    variantKeys: s.variant ? mapVariantKeys(data.variantKeys || [], myVariants, theirVariants) : [],
    qtyByVariant: s.qty && s.variant ? mapVariantQty(data.qtyByVariant, myVariants, theirVariants) : {},
  };
}
