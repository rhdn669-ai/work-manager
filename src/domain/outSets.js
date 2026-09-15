// 재고 「나감」 — 품목 줄마다 «몇 대분이 나갔고 몇 대분이 모자란가». (2026-09-15 대표님)
//
// 두 가지 셈이 있다.
//   도급·판금  세트 기준 — 이 갈래 자재를 하나라도 가져간 호기가 9대면 모든 줄이 「9 SET」.
//              그 9대 중 이 줄을 덜 채운 호기(제외로 꺼 둔 호기는 빼고)를 「· 부족 M」으로.
//              (「도급에 9set 기준으로 어찌저찌 채워서 나갔으니까 9set 기준으로 다시 시작」)
//   사급       체크 기준 — 이 줄에 실제로 넣은 호기만 센다. 다 채운 호기가 SET, 덜 넣은 호기가 부족.
//              (「사급은 그전 처럼 체크된 호기에 한해서 셋트수량 채우는걸로」)
// started(시작한 호기 집합)를 주면 세트 기준, 안 주면 체크 기준이다.

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
 * { sets, full, short }
 *   started 를 주면(도급·판금) sets = 시작한 호기 수, short = 그중 다 못 채운 호기(제외는 뺌).
 *   안 주면(사급)          sets = 이 줄에 넣은 호기 수, short = 그중 덜 넣은 호기.
 * full 은 어느 줄에서든 덜 채운 호기를 뺀 「다 채운 호기」 수.
 */
export function outSetsOf(tally, key, started = null) {
  const t = tally.get(key) || { full: new Set(), part: new Set(), skip: new Set() };
  const fullIds = new Set([...t.full].filter((id) => !t.part.has(id)));
  if (!started) {
    const sets = new Set([...t.full, ...t.part]).size;
    return { sets, full: fullIds.size, short: Math.max(0, sets - fullIds.size) };
  }
  let short = 0;
  for (const id of started) if (!fullIds.has(id) && !t.skip.has(id)) short += 1;
  return { sets: started.size, full: fullIds.size, short };
}

/** 「9 SET」 · 「9 SET · 부족 4」 */
export function outSetsLabel({ sets = 0, short = 0 } = {}) {
  const n = Number(sets) || 0;
  const m = Number(short) || 0;
  return m > 0 ? `${n.toLocaleString()} SET · 부족 ${m}` : `${n.toLocaleString()} SET`;
}
