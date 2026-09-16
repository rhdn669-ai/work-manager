// 두 BOM 맞대기 — 프로버 (메티스)와 프로버 (디에이치)처럼 «도급·사급 기준만 다르고 나머지는
// 같아야 하는» BOM 두 개의 차이를 뽑는다. (2026-09-16 대표님 「매번 따로 추가하자니 놓치는
// 부분과 번거로움이 생기는데」)
//
// 짝짓는 기준은 «품목 + BOX» 다. 품목 하나가 여러 BOX 에 쓰이므로 품목만으로는 못 가른다
// (MP 의 Relay 는 메티스에만, 같은 품목이 다른 BOX 에는 양쪽 다 있다).
// 품목번호가 없는 줄은 품명+규격으로 맞춘다.
//
// 구분(도급·사급)은 «회사마다 다른 것이 정상» 이라 차이로 보지 않는다 — 실측 66줄이 다르다.
// 타입(variant)은 프로젝트마다 키가 달라(vT5391 ↔ vmtwa6ghk) 라벨로 짝지어 옮긴다.

/** 줄의 짝짓기 열쇠 — 품목번호(없으면 품명+규격) + BOX */
export function rowKey(r) {
  const id = String(r?.itemId || '').trim();
  const box = String(r?.box || '').trim();
  const fallback = `${String(r?.name || '').trim()}|${String(r?.spec || '').trim()}`;
  return `${id || fallback}@@${box}`;
}

/** 같은 열쇠의 줄들을 모은다 — 한 BOX 에 같은 품목이 두 줄 있을 수 있다 */
function groupByKey(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = rowKey(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

const qtyOf = (r) => Number(r?.qty) || 0;
const sumQty = (list) => list.reduce((a, r) => a + qtyOf(r), 0);

/** 줄들이 걸린 타입을 «라벨» 로 모은다 — 키는 프로젝트마다 달라 라벨로만 견줄 수 있다.
 *  타입을 안 건 줄(공통)은 「공통」으로 센다 (2026-09-16 대표님 「타입도 같이 가져와야」) */
export function variantLabels(list, variants) {
  const byKey = new Map((variants || []).map((v) => [v.key, String(v.label || '').trim()]));
  const out = new Set();
  for (const r of list || []) {
    const ks = Array.isArray(r?.variantKeys) ? r.variantKeys : [];
    if (ks.length === 0) out.add('공통');
    for (const k of ks) out.add(byKey.get(k) || k);
  }
  return [...out].sort();
}

const sameLabels = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 차이 목록.
 * @param mine   내 BOM 줄
 * @param theirs 맞댈 BOM 줄
 * @returns [{ kind, key, box, name, spec, itemId, mineQty, theirQty, mineRows, theirRows }]
 *   kind 'onlyMine'  내 쪽에만 있다 → 상대에 넣어 주면 같아진다
 *        'onlyTheirs' 상대에만 있다 → 내 쪽에 가져오면 같아진다
 *        'qty'        양쪽 다 있는데 수량이 다르다
 */
export function diffBomRows(mine, theirs, { mineVariants = [], theirVariants = [] } = {}) {
  const a = groupByKey(mine);
  const b = groupByKey(theirs);
  const out = [];
  const vm = (list) => variantLabels(list, mineVariants);
  const vt = (list) => variantLabels(list, theirVariants);
  const label = (list) => {
    const r = list[0] || {};
    return {
      box: r.box || '',
      name: r.name || '',
      spec: r.spec || '',
      code: r.code || '',
      drawingNo: r.drawingNo || '',
      itemId: r.itemId || '',
    };
  };
  for (const [k, list] of a) {
    if (!b.has(k)) {
      out.push({
        kind: 'onlyMine',
        key: k,
        ...label(list),
        mineQty: sumQty(list),
        theirQty: 0,
        mineVariants: vm(list),
        theirVariants: [],
        mineRows: list,
        theirRows: [],
      });
      continue;
    }
    const other = b.get(k);
    const mv = vm(list);
    const tv = vt(other);
    const qtyDiff = sumQty(list) !== sumQty(other);
    const varDiff = !sameLabels(mv, tv);
    if (qtyDiff || varDiff) {
      out.push({
        kind: qtyDiff ? 'qty' : 'variant',
        key: k,
        ...label(list),
        mineQty: sumQty(list),
        theirQty: sumQty(other),
        mineVariants: mv,
        theirVariants: tv,
        mineRows: list,
        theirRows: other,
      });
    }
  }
  for (const [k, list] of b) {
    if (!a.has(k)) {
      out.push({
        kind: 'onlyTheirs',
        key: k,
        ...label(list),
        mineQty: 0,
        theirQty: sumQty(list),
        mineVariants: [],
        theirVariants: vt(list),
        mineRows: [],
        theirRows: list,
      });
    }
  }
  const order = { onlyTheirs: 0, onlyMine: 1, qty: 2, variant: 3 };
  return out.sort(
    (x, y) =>
      order[x.kind] - order[y.kind] || String(x.box).localeCompare(y.box) || String(x.name).localeCompare(y.name),
  );
}

/**
 * 타입 키 옮기기 — 프로젝트마다 키가 달라 라벨로 짝짓는다.
 * 상대 프로젝트에 같은 라벨이 없으면 그 타입은 떨어뜨린다(= 공통 줄이 된다).
 */
export function mapVariantKeys(keys, fromVariants, toVariants) {
  const byKey = new Map((fromVariants || []).map((v) => [v.key, String(v.label || '').trim()]));
  const byLabel = new Map((toVariants || []).map((v) => [String(v.label || '').trim(), v.key]));
  const out = [];
  for (const k of keys || []) {
    const label = byKey.get(k);
    const mapped = label ? byLabel.get(label) : null;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * 복사해 넣을 줄 — 구분(도급·사급)은 «받는 쪽» 기준을 따른다.
 * 받는 BOM 에 같은 품목이 이미 있으면 그 구분을, 없으면 도급(빈 값)으로 둔다.
 */
export function rowToCopy(src, { toRows = [], fromVariants = [], toVariants = [], order = 0 } = {}) {
  const id = String(src.itemId || '').trim();
  const twin = id ? (toRows || []).find((r) => String(r.itemId || '').trim() === id) : null;
  return {
    itemId: src.itemId || '',
    name: src.name || '',
    spec: src.spec || '',
    unit: src.unit || '',
    qty: Number(src.qty) || 0,
    unitPrice: Number(src.unitPrice) || 0,
    box: src.box || '',
    note: src.note || '',
    drawingNo: src.drawingNo || '',
    supplyType: twin ? twin.supplyType || '' : '',
    variantKeys: mapVariantKeys(src.variantKeys, fromVariants, toVariants),
    order,
  };
}
