// 재고 「나감」 — 품목 줄마다 «몇 대분이 나갔고 몇 대분이 모자란가». (2026-09-15 대표님)
//
// 세트는 호기 수로 센다. 이 갈래 자재를 하나라도 가져간 호기가 9대면 세트 9개가 나간 것이다.
// 줄마다 「9 SET」은 같고, 그 9대 중 이 줄을 덜 채운 호기 수를 「부족」으로 붙인다
// (「도급 재고는 9set 로 맞춰줘」 「일부로 표시하지말고 부족 n 으로」 「9set 으로 가야겠지 부족이니까」).
//   sets   이 갈래를 시작한 호기 수(이 줄이 「제외」인 호기는 뺌) → 「N SET」
//   short  그중 이 줄을 다 못 채운 호기                       → 「· 부족 M」  (0 개도 포함)
// 그 호기에서 「제외」로 꺼 둔 줄은 그 호기가 필요 없다는 뜻이라 세트에서도 뺀다.

export function outTally() {
  return new Map();
}

/** 호기 하나가 이 줄에 got 개 넣었다 — need 는 필요 수량, skip 이면 이 호기에서 제외된 줄 */
export function tallyOut(tally, key, panelId, got, need, skip = false) {
  if (!key) return;
  let t = tally.get(key);
  if (!t) {
    t = { full: new Set(), part: new Set(), skip: new Set() };
    tally.set(key, t);
  }
  if (skip) {
    t.skip.add(panelId);
    return;
  }
  const g = Number(got) || 0;
  if (g <= 0) return;
  (g >= (Number(need) || 0) ? t.full : t.part).add(panelId);
}

/**
 * { sets, full, short } — started 는 이 갈래를 시작한 호기(Set). 없으면 이 줄에 넣은 호기만으로 센다.
 * sets 는 그중 이 줄이 제외가 아닌 호기 수, full 은 다 채운 호기, short = sets − full.
 */
export function outSetsOf(tally, key, started = null) {
  const t = tally.get(key) || { full: new Set(), part: new Set(), skip: new Set() };
  let full = 0;
  for (const id of t.full) if (!t.part.has(id)) full += 1;
  const base = started || new Set([...t.full, ...t.part]);
  let sets = 0;
  for (const id of base) if (!t.skip.has(id)) sets += 1;
  return { sets, full, short: Math.max(0, sets - full) };
}

/** 「9 SET」 · 「9 SET · 부족 4」 */
export function outSetsLabel({ sets = 0, short = 0 } = {}) {
  const n = Number(sets) || 0;
  const m = Number(short) || 0;
  return m > 0 ? `${n.toLocaleString()} SET · 부족 ${m}` : `${n.toLocaleString()} SET`;
}
