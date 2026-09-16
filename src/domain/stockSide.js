// 사급 통은 «고객사 것»과 «당사가 댄 것» 두 칸이다. 수량은 진작에 나눠 셌는데 기록만 한 줄기를
// 같이 써서, 고객사 칸을 보든 당사 칸을 보든 남의 칸 일까지 다 떴다
// (2026-09-16 대표님 「사급재고 기록 고객사와당사 공유x」).
//
// 기록 한 줄이 두 칸에 걸치기도 한다 — 5개 나갔는데 그중 2개가 당사 몫이면 고객사 칸에서는
// 「3 나감」, 당사 칸에서는 「2 나감」으로 보여야 맞다. 그래서 줄을 «칸 몫»으로 고쳐 준다.
//
//   들어옴(in)        ours 가 참이면 당사 것, 아니면 고객사 것 — 통째로 한 칸
//   나감(out)         fromOurs 만큼 당사 칸에서, 나머지는 고객사 칸에서
//   되돌림(back)      toOurs 만큼 당사 칸으로, 나머지는 고객사 칸으로
//   발주 입고(po-*)   당사 몫을 안 건드리므로 고객사 칸
//   손으로 맞춤(fix)  side 가 적힌 줄은 그 칸만. 옛 줄에는 side 가 없어 «어느 칸인지 모른다»

/** 이 줄에서 그 칸이 가진 몫. 칸을 안 주면(도급·판금) 줄 전체를 그대로 돌려준다. */
export function sideShare(l, side = null) {
  if (!side) return { n: Number(l?.n) || 0, whole: true };
  const n = Math.max(0, Number(l?.n) || 0);
  const kind = String(l?.kind || '');
  const ours = side === 'ours';
  if (kind === 'in') {
    const mine = !!l?.ours;
    return { n: mine === ours ? n : 0, whole: true };
  }
  if (kind === 'out') {
    const fromOurs = Math.min(n, Math.max(0, Number(l?.fromOurs) || 0));
    return { n: ours ? fromOurs : n - fromOurs, whole: true };
  }
  if (kind === 'back') {
    const toOurs = Math.min(n, Math.max(0, Number(l?.toOurs) || 0));
    return { n: ours ? toOurs : n - toOurs, whole: true };
  }
  if (kind.startsWith('po-')) return { n: ours ? 0 : n, whole: true };
  if (kind === 'fix') {
    // side 가 적힌 줄은 그 칸 이야기. 안 적힌 옛 줄은 두 칸 합계를 고친 것이라 몫을 못 가른다.
    if (!l?.side) return { n, whole: false };
    return { n: l.side === side ? n : 0, whole: true, skip: l.side !== side };
  }
  return { n: 0, whole: true };
}

/** 그 칸에 보일 줄만. 남의 칸에서만 오간 줄(그 칸 몫 0)은 뺀다 — 헛줄이라 헷갈린다. */
export function logsForSide(logs, side = null) {
  if (!side) return [...(logs || [])];
  return (logs || []).filter((l) => {
    const s = sideShare(l, side);
    if (String(l?.kind) === 'fix') return !s.skip; // 칸 모르는 옛 줄은 양쪽에 다 남긴다
    return s.n > 0;
  });
}
