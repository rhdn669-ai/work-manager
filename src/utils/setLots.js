// 발주서에 담은 「세트」 내역 — BOM 타입(형번)별로 몇 세트인지 각각 남긴다.
//
// 여태 세트 수를 숫자 하나(setCount)로만 들고 있어서, 한 발주서에 두 타입을
// 담으면 나중에 담은 것이 앞의 것을 덮어썼다. 프로버 5세트 + M7H 6세트를
// 담아도 헤더에는 「6세트」만 남는 식이었다.
//
// 같은 타입을 또 담으면 줄을 늘리지 않고 세트 수만 더한다 — 품목 합치기와 같은 방식.

export function mergeSetLots(lots, name, count) {
  const n = String(name ?? '').trim();
  const c = Number(count) || 0;
  const list = Array.isArray(lots)
    ? lots.map((l) => ({ name: String(l?.name ?? ''), count: Number(l?.count) || 0 }))
    : [];
  if (!n || c <= 0) return list;
  const hit = list.find((l) => l.name === n);
  if (hit) {
    hit.count += c;
    return list;
  }
  return [...list, { name: n, count: c }];
}

// 「T5391 5세트 · M7H 6세트」 — 헤더 배지에 그대로 쓴다
export function setLotsLabel(lots) {
  return (Array.isArray(lots) ? lots : [])
    .filter((l) => l && String(l.name ?? '').trim() && Number(l.count) > 0)
    .map((l) => `${l.name} ${Number(l.count)}세트`)
    .join(' · ');
}

export function totalSetCount(lots) {
  return (Array.isArray(lots) ? lots : []).reduce((s, l) => s + (Number(l?.count) || 0), 0);
}
