// 사급 재고 안에서 「고객사가 준 것」과 「우리가 댄 것」을 가른다. (2026-09-12 대표님)
//
// BOM 에 사급으로 적힌 품목인데 고객사가 안 주고 우리가 가진 것을 대는 일이 있다. 같은 통에
// 섞어 두면 나중에 「이건 우리가 댄 건데」를 가릴 수 없어, 청구도 정산도 못 한다.
//
// 통은 하나로 두고 숫자만 가른다 — 줄이 두 배로 늘지 않게.
//   qty  통에 있는 전부
//   ours 그중 «우리가 댄» 몫   (고객사 것 = qty − ours)
//
// 쓸 때는 «고객사 것부터» 나간다 (대표님 「고객사거 먼저」). 받은 것을 먼저 쓰고 우리 것을
// 아껴 두어야, 남은 우리 몫이 그대로 「우리가 N개 댔다」는 근거가 된다.

/**
 * 재고에서 n 개를 꺼낼 때 — 고객사 몫부터.
 * @returns { take, fromOurs } take 실제로 꺼낸 양, fromOurs 그중 우리 몫
 */
export function takeOrder({ qty = 0, ours = 0, want = 0 } = {}) {
  const have = Math.max(0, Number(qty) || 0);
  const mine = Math.min(Math.max(0, Number(ours) || 0), have);
  const take = Math.min(Math.max(0, Number(want) || 0), have);
  if (take <= 0) return { take: 0, fromOurs: 0 };
  const theirs = have - mine; // 고객사 몫
  const fromOurs = Math.max(0, take - theirs); // 고객사 것으로 모자란 만큼만 우리 것에서
  return { take, fromOurs };
}

/**
 * 되돌릴 때 — 꺼낼 때 우리 몫에서 나갔던 만큼을 먼저 우리 몫으로 돌린다.
 * @param back      돌려줄 양
 * @param tookOurs  그 줄이 우리 몫에서 꺼냈던 누계
 * @returns { back, toOurs }
 */
export function returnOrder({ back = 0, tookOurs = 0 } = {}) {
  const n = Math.max(0, Number(back) || 0);
  const mine = Math.max(0, Number(tookOurs) || 0);
  return { back: n, toOurs: Math.min(n, mine) };
}

/** 화면에 쓰는 갈래 */
