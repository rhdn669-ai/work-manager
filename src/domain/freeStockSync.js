// 사급 수량을 고쳤을 때 재고 통을 어떻게 움직일지 — 셈만 따로 둔다.
//
// 사급은 언제나 통을 거친다. 통에 없으면 그만큼 「방금 들어온 것」으로 적고 곧바로 내보낸다.
// 그런데 그 「없던 것을 만든 양」을 되돌릴 때 통으로 돌려주면 원래 없던 재고가 생긴다
// (2026-09-12 대표님 「없는 수량을 넣었다가 다시빼면 없던 재고가 생겨버림」).
// 그래서 자동으로 받은 만큼(autoIn)은 되돌릴 때 «없던 일»로 만든다 — 통은 그대로.
//
// @param {number} before  고치기 전 이 호기의 개수
// @param {number} after   고친 뒤 개수
// @param {number} have    지금 통에 있는 개수
// @param {number} autoIn  이 줄에서 지금까지 「없는데 바로 체크」로 만든 누계
// @returns null | { receive, take, giveBack, autoIn }
//   receive  통에 받은 걸로 적을 양
//   take     통에서 뺄 양
//   giveBack 통으로 돌려줄 양
//   autoIn   새로 적어 둘 누계
export function freeStockMoves({ before = 0, after = 0, have = 0, autoIn = 0 } = {}) {
  const b = Math.max(0, Number(before) || 0);
  const a = Math.max(0, Number(after) || 0);
  const h = Math.max(0, Number(have) || 0);
  const auto = Math.max(0, Number(autoIn) || 0);
  const d = a - b;
  if (d === 0) return null;

  if (d > 0) {
    const receive = Math.max(0, d - h); // 통에 없던 만큼
    return { receive, take: d, giveBack: 0, autoIn: auto + receive };
  }

  const back = -d;
  const cancel = Math.min(back, auto); // 만들어 냈던 만큼은 없던 일로
  return { receive: 0, take: 0, giveBack: back - cancel, autoIn: auto - cancel };
}
