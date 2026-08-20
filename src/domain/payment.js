// 회차 결제 — 같은 발주서에서 한 업체 물량이 나눠 들어올 때, 들어온 만큼씩 나눠 결제한다.
//
// 예) 22개 발주 → 9월에 11개 입고 → 그만큼 1차 결제 → 10월에 11개 입고 → 2차 결제.
//
// 회차마다 무엇이 얼마나 들어왔는지 따로 적어 두지 않는다. 지금까지 「입고된 금액」에서
// 「이미 결제한 금액」을 빼면 이번에 청구할 몫이 나온다. 나중에 입고 수량을 고쳐도
// 총액이 어긋나지 않는 방식이다 (2026-08-20 대표님).
//
// 옛 기록에는 금액이 없다(그때는 한 번에 다 결제했다). 그런 건은 「전액 결제됨」으로 보아
// 추가 청구가 생기지 않게 한다 — 없는 돈을 다시 달라고 하는 일이 없어야 한다.

// 저장된 값을 회차 배열로 — 옛 기록(객체 하나)도 1차 한 건으로 읽는다.
export function paidList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return [{ seq: 1, ...raw }];
}

// 금액이 적히지 않은 옛 기록이 있으면 얼마를 냈는지 알 수 없다 → 전액 결제로 본다.
export function hasLegacyPaid(raw) {
  return paidList(raw).some((p) => p.amount == null);
}

export function paidTotal(raw) {
  return paidList(raw).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

// 이번에 청구할 몫 — 들어온 금액에서 이미 낸 금액을 뺀다 (공급가액 기준).
export function unpaidAmount(receivedSupply, raw) {
  if (hasLegacyPaid(raw)) return 0;
  return Math.max(0, (Number(receivedSupply) || 0) - paidTotal(raw));
}

// 다음 회차 번호
export function nextSeq(raw) {
  return paidList(raw).length + 1;
}

// 결제 버튼에 적을 말. 1차는 회차를 붙이지 않는다 — 대부분의 발주는 한 번에 끝난다.
export function payButtonLabel(raw) {
  const seq = nextSeq(raw);
  return seq === 1 ? '결제 요청' : `${seq}차 결제요청`;
}

// 완료된 회차 이름 (결제 페이지·마우스 설명용)
export function seqLabel(seq, total) {
  if (!total || total <= 1) return '';
  return `${seq}차`;
}
