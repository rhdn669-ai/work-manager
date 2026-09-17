// 호기 타입(형번)이 바뀔 때 무엇이 어긋나는가 — 순수 셈.
// (2026-09-17 대표님 「타입이 변경되면서 초과·부족 수량은 보라색 띠로 표시」)
//
// 타입 전용 줄(variantKeys 가 있는 줄)은 그 타입 호기에만 보인다. 그래서 타입을 바꾸면
// 옛 타입 줄이 화면에서 사라지는데, 체크한 수량과 «통에서 가져온 몫»은 데이터에 그대로 남아
// 어느 집계에도 안 잡힌다 — 통은 줄었는데 쓴 데가 없는 «증발»이 된다.
// 그래서 사라질 줄을 미리 세어 보여 주고(확인 창), 그래도 남은 것은 표에 보라 띠로 계속 띄운다.

/** 줄이 이 타입에 해당하나 — 타입이 빈 호기(미지정)는 모든 줄을 본다 */
export function rowFitsVariant(row, variantKey) {
  const ks = Array.isArray(row?.variantKeys) ? row.variantKeys : [];
  if (ks.length === 0) return true; // 공통 자재
  if (!variantKey) return true; // 타입 미지정 호기 — 전용 줄이 모두 보인다(경고 대상)
  return ks.includes(variantKey);
}

/** 이 호기에서 «지금 타입 밖»인데 체크돼 있는 줄 — 표에 보라로 띄울 것들 */
export function strayRows(rows, variantKey, gotOf) {
  if (!variantKey) return []; // 타입 미지정이면 모든 줄이 제 자리다
  return (rows || []).filter((r) => !rowFitsVariant(r, variantKey) && (Number(gotOf(r)) || 0) > 0);
}

/**
 * 타입을 nextKey 로 바꾸면 무엇이 달라지나.
 * @param rows   이 호기 BOM 의 «거르기 전» 전체 줄 (BOX 무관)
 * @param curKey 지금 타입 열쇠 · nextKey 바꿀 타입 열쇠
 * @param gotOf  줄 → 체크 수량
 * @returns { leaving: [{row, got}], arriving: [row], leavingQty }
 *   leaving   사라지는 줄 가운데 «체크가 있는» 것 — 이것이 경고 대상
 *   arriving  새로 생기는 줄(전엔 안 보이던 전용 줄)
 */
export function variantChangePlan(rows, curKey, nextKey, gotOf) {
  const leaving = [];
  const arriving = [];
  for (const r of rows || []) {
    const was = rowFitsVariant(r, curKey);
    const will = rowFitsVariant(r, nextKey);
    if (was && !will) {
      const got = Number(gotOf(r)) || 0;
      if (got > 0) leaving.push({ row: r, got });
    } else if (!was && will) {
      arriving.push(r);
    }
  }
  return { leaving, arriving, leavingQty: leaving.reduce((a, x) => a + x.got, 0) };
}
