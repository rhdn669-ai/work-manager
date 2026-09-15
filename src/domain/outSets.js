// 재고 「나감」 — 품목 줄마다 «몇 대가 가져갔나». (2026-09-15 대표님)
//
// 개수÷1대당으로 세면 한 호기가 덜 넣었거나 BOX 마다 1대당이 달라 줄마다 8·4 SET 로 갈라지고,
// 갈래 전체를 하나로 세면 아직 안 나간 품목까지 9 SET 로 보인다 (「안나간 품목은 set 표시를
// 안올려야 맞는거아님?」). 그래서 줄마다 호기를 둘로 가른다:
//   full  그 줄을 다 채운 호기        → 「N SET」
//   part  하나라도 넣었지만 덜 채운 호기 → 「· M대 일부」
// 한 호기가 같은 품목의 어느 줄에서든 덜 채웠으면 그 호기는 「일부」다.

export function outTally() {
  return new Map();
}

/** 호기 하나가 이 줄에 got 개 넣었다 — need 는 그 줄의 필요 수량 */
export function tallyOut(tally, key, panelId, got, need) {
  const g = Number(got) || 0;
  if (g <= 0 || !key) return;
  let t = tally.get(key);
  if (!t) {
    t = { full: new Set(), part: new Set() };
    tally.set(key, t);
  }
  (g >= (Number(need) || 0) ? t.full : t.part).add(panelId);
}

/** { full, part, qty } — full 은 일부에 걸린 호기를 뺀 수 */
export function outSetsOf(tally, key) {
  const t = tally.get(key);
  if (!t) return { full: 0, part: 0 };
  let full = 0;
  for (const id of t.full) if (!t.part.has(id)) full += 1;
  return { full, part: t.part.size };
}

/** 「9 SET」 · 「9 SET · 1대 일부」 */
export function outSetsLabel({ full = 0, part = 0 } = {}) {
  const n = Number(full) || 0;
  const m = Number(part) || 0;
  return m > 0 ? `${n.toLocaleString()} SET · ${m}대 일부` : `${n.toLocaleString()} SET`;
}
