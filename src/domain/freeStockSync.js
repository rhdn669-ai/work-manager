// 사급 수량을 고쳤을 때 재고를 어떻게 움직일지 — 셈만 따로 둔다.
//
// 규칙은 한 줄이다: **재고에서 가져온 만큼만 재고로 돌아간다.**
// (2026-09-12 대표님 「재고에서 가져온 수량이 아니면 다시 제거해도 재고로 채워지면 안되지」)
//
// 전에는 호기에서 수량을 적기만 해도 재고를 거치는 것으로 쳤다. 그래서 실물을 직접 받아
// 체크한 줄을 지우면, 가져온 적도 없는 물건이 재고로 «생겨났다».
//
// 이제 재고가 움직이는 때는 둘뿐이다.
//   늘릴 때 — 재고에 있는 만큼만 꺼내 쓰고, 꺼낸 양을 그 줄에 적어 둔다(fromStock).
//             재고에 없는 몫은 실물이 직접 온 것이므로 재고와 상관없다.
//   줄일 때 — 그 줄이 재고에서 꺼내 썼던 만큼만 돌려준다. 그 이상은 돌려주지 않는다.
//
// @param {number} before    고치기 전 이 호기의 개수
// @param {number} after     고친 뒤 개수
// @param {number} have      지금 재고에 있는 개수
// @param {number} fromStock 이 줄이 지금까지 재고에서 꺼내 쓴 누계
// @returns null | { take, giveBack, fromStock }
//   take      재고에서 뺄 양
//   giveBack  재고로 돌려줄 양
//   fromStock 새로 적어 둘 누계
export function freeStockMoves({ before = 0, after = 0, have = 0, fromStock = 0 } = {}) {
  const b = Math.max(0, Number(before) || 0);
  const a = Math.max(0, Number(after) || 0);
  const h = Math.max(0, Number(have) || 0);
  const kept = Math.max(0, Number(fromStock) || 0);
  const d = a - b;
  if (d === 0) return null;

  if (d > 0) {
    const take = Math.min(d, h); // 재고에 있는 만큼만
    if (take <= 0) return null; // 실물이 직접 온 몫 — 재고는 그대로
    return { take, giveBack: 0, fromStock: kept + take };
  }

  const back = -d;
  const giveBack = Math.min(back, kept); // 꺼내 썼던 만큼만
  if (giveBack <= 0) return null;
  return { take: 0, giveBack, fromStock: kept - giveBack };
}
