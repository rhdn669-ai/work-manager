// 생산현황 행 순서 — 손으로 끌어 정한 차례 (2026-09-03 대표님 「순서 이동」).
//
// 납기가 바뀔 예정이라 미리 줄을 옮겨 두는 용도다. 그래서 잠그거나 되돌리는 대신,
// 납기 날짜 순서와 어긋난 줄만 경고색으로 보여 준다 (「순번이랑 안 맞게 이동이 됐을 때는
// 행 색상에 경고 색상으로만 처리」).

/** 저장된 순서값 — 없으면 맨 뒤(납기순으로 이어짐) */
export function orderOf(p) {
  return Number.isFinite(p?.order) ? p.order : Number.MAX_SAFE_INTEGER;
}

/**
 * 납기 순서와 어긋난 줄의 id 집합.
 * 위쪽 어느 줄보다 납기가 빠르거나, 아래쪽 어느 줄보다 납기가 늦으면 어긋난 것으로 본다 —
 * 그래야 자리를 바꾼 두 줄이 모두 표시된다. 납기가 빈 줄은 판정에서 뺀다.
 */
export function misorderedIds(panels) {
  const out = new Set();
  const dated = panels.filter((p) => p && p.납기);
  let maxAbove = '';
  for (const p of dated) {
    if (maxAbove && p.납기 < maxAbove) out.add(p.id);
    if (p.납기 > maxAbove) maxAbove = p.납기;
  }
  let minBelow = '';
  for (let i = dated.length - 1; i >= 0; i--) {
    const p = dated[i];
    if (minBelow && p.납기 > minBelow) out.add(p.id);
    if (!minBelow || p.납기 < minBelow) minBelow = p.납기;
  }
  return out;
}

/**
 * 화면에 보이는 줄(검색·필터로 걸러진 것) 안에서 active 를 over 자리로 옮겼을 때,
 * 회사 전체 목록(fullIds)의 새 차례를 돌려준다. 숨은 줄은 제자리를 지킨다.
 */
export function mergeMove(fullIds, visibleIds, activeId, overId) {
  const from = visibleIds.indexOf(activeId);
  const to = visibleIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return fullIds.slice();
  // 아래로 끌면 over 바로 뒤, 위로 끌면 over 바로 앞 — 눈에 보인 그대로
  const full = fullIds.filter((id) => id !== activeId);
  const at = full.indexOf(overId) + (from < to ? 1 : 0);
  full.splice(at < 0 ? full.length : at, 0, activeId);
  return full;
}
