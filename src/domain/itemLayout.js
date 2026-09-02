// 품목 대분류 배치 — 「차례」를 코드로 새기는 계산만 모아 둔다.
//
// 대분류 번호는 «보이는 차례»가 곧 번호다: 첫 번째가 IOPN-000, 그다음이 IOPN-001…
// 하위는 그 아래에서 IOPN-000-1, -2 … 로 매긴다. 그래서 대분류 하나를 위로 올리면
// 그 사이에 낀 대분류와 하위 품목 코드가 한꺼번에 밀린다
// (2026-09-02 대표님 「대분류도 드래그 드롭으로 순서 바꿀수있게」·「코드도 다시 매긴다」).
//
// 화면과 서버 양쪽에서 같은 답이 나와야 해서 여기 한 곳에 둔다.

/** 대분류 차례(0부터)를 코드 앞머리로 — 0 → 'IOPN-000' */
export function mainCodeOf(index) {
  return `IOPN-${String(index).padStart(3, '0')}`;
}

/**
 * 배치를 코드·소속으로 옮긴 뒤, 지금 값과 «달라지는 것만» 골라낸다.
 * groups: [{ repId, subIds: [...] }] — 화면 순서 그대로
 * 돌려주는 것: [{ id, patch }] — patch 에 code / groupKey
 */
export function groupLayoutUpdates(groups, currentItems) {
  const byId = new Map((currentItems || []).map((it) => [it.id, it]));
  const updates = [];

  (groups || []).forEach((g, gi) => {
    const main = mainCodeOf(gi);

    const rep = byId.get(g.repId);
    if (rep && !String(g.repId).startsWith('tmp-') && rep.code !== main) {
      updates.push({ id: g.repId, patch: { code: main } });
    }

    (g.subIds || []).forEach((id, si) => {
      const cur = byId.get(id);
      if (!cur || String(id).startsWith('tmp-')) return;
      const patch = {};
      const code = `${main}-${si + 1}`;
      if (cur.code !== code) patch.code = code;
      // 다른 대분류에서 옮겨 온 품목은 소속도 바꿔 준다
      if (g.repId && (cur.groupKey || '') !== g.repId) patch.groupKey = g.repId;
      if (Object.keys(patch).length > 0) updates.push({ id, patch });
    });
  });

  return updates;
}

/**
 * 끌어다 놓은 결과의 배치를 계산한다. 무엇을 어디에 떨궜는지로 갈린다.
 *   대분류 → 대분류            : 차례 바꾸기
 *   품목   → 같은 대분류 안     : 차례 바꾸기
 *   품목   → 다른 대분류 카드   : 그 대분류 맨 끝으로
 *   품목   → 다른 대분류의 품목 : 그 품목 자리로
 * 옮길 곳이 마땅치 않으면 null — 부르는 쪽은 아무것도 하지 않는다.
 *
 * groupKeys: 화면에 보이는 대분류 키 차례 (드래그 id 는 `g:{key}`)
 */
export function moveInLayout(layout, activeId, overId, groupKeys) {
  if (!layout || !activeId || !overId || activeId === overId) return null;
  const a = String(activeId);
  const o = String(overId);
  const groupIndexOf = (dragId) => (groupKeys || []).findIndex((k) => `g:${k}` === dragId);

  if (a.startsWith('g:')) {
    if (!o.startsWith('g:')) return null;
    const from = groupIndexOf(a);
    const to = groupIndexOf(o);
    if (from < 0 || to < 0 || from === to) return null;
    const next = [...layout];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  const srcGi = layout.findIndex((g) => (g.subIds || []).includes(a));
  if (srcGi < 0) return null;

  let dstGi;
  let insertAt;
  if (o.startsWith('g:')) {
    dstGi = groupIndexOf(o);
    insertAt = dstGi >= 0 ? (layout[dstGi].subIds || []).length : -1; // 카드 위에 떨구면 맨 끝
  } else {
    dstGi = layout.findIndex((g) => (g.subIds || []).includes(o));
    insertAt = dstGi >= 0 ? layout[dstGi].subIds.indexOf(o) : -1;
  }
  if (dstGi < 0 || insertAt < 0) return null;

  const next = layout.map((g) => ({ ...g, subIds: [...(g.subIds || [])] }));
  if (srcGi === dstGi) {
    // 같은 대분류 안 — 「집어서 그 자리에 놓는다」. 빼고 나서 자리를 다시 세면
    // 아래로 옮길 때 한 칸 덜 간다.
    const arr = next[srcGi].subIds;
    const from = arr.indexOf(a);
    arr.splice(insertAt, 0, arr.splice(from, 1)[0]);
  } else {
    next[srcGi].subIds.splice(next[srcGi].subIds.indexOf(a), 1);
    next[dstGi].subIds.splice(insertAt, 0, a);
  }
  return next;
}
