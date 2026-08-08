// 발주 한 줄의 입고분을 걸린 호기들에 나눠 준다.
//
// 규칙 (2026-08-08 대표님):
//   · 입고는 한 번에 되므로 발주서 단위로 호기를 걸고, 배정만 순서대로 한다.
//   · 생산이 빠른 호기부터 채우고, 모자라면 뒤에 생산하는 호기가 미입고로 남는다.
//   · 호기 순서는 생산현황과 같다 — 납기 빠른 순, 같으면 호기 번호 순.
//
// 필요 수량은 호기 수로 고르게 나누고, 나눠떨어지지 않는 몫은 앞 호기가 하나씩 더 가져간다.
// (10개를 3호기에 → 4·3·3)

export function splitNeed(qty, panelCount) {
  const total = Math.max(0, Number(qty) || 0);
  const n = Math.max(0, Number(panelCount) || 0);
  if (n === 0) return [];
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

// 입고된 수량을 앞 호기부터 채운다.
// 반환: [{ need, got, short }] — 호기 순서 그대로
export function allocateReceived(qty, received, panelCount) {
  const needs = splitNeed(qty, panelCount);
  let left = Math.max(0, Number(received) || 0);
  return needs.map((need) => {
    const got = Math.min(need, left);
    left -= got;
    return { need, got, short: need - got };
  });
}

// 발주서 전체를 보고 호기별로 「다 받았는지」를 낸다.
// items: 발주 품목 줄(qty, receivedQty), panels: 걸린 호기(순서대로)
// 반환: [{ panel, done, shortLines }] — shortLines 는 그 호기가 못 받은 품목 줄
export function panelReceiveStatus(items, panels) {
  const list = Array.isArray(panels) ? panels : [];
  if (list.length === 0) return [];
  const stat = list.map((panel) => ({ panel, done: true, shortLines: [] }));
  for (const ln of items || []) {
    if (!(ln?.name || '').trim() && !ln?.itemId) continue;
    const alloc = allocateReceived(ln.qty, ln.receivedQty, list.length);
    alloc.forEach((a, i) => {
      if (a.short > 0) {
        stat[i].done = false;
        stat[i].shortLines.push({ name: ln.name || '', spec: ln.spec || '', need: a.need, got: a.got });
      }
    });
  }
  return stat;
}
