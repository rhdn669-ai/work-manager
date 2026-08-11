// 재고 관리 대상인지 — 「재고」 탭에 올려 둔 품목만 해당한다.
//
// 수량 0 과 「재고를 안 세는 품목」은 다르다. 0 은 창고가 비었다는 뜻이고,
// 값이 아예 없으면 애초에 재고를 세지 않는 품목이다.
// 발주서 재고 칸도 이 기준으로 그린다 — 재고 탭에 없는 품목엔 버튼을 띄우지 않는다.
export function isStockTracked(item) {
  return !!item && item.stockQty !== undefined && item.stockQty !== null;
}
