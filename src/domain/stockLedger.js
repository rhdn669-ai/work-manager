// 재고 통이 «실값»인가 — 갈래마다 다르다. (2026-09-15 설계 「재고를 통 실값 하나로」)
//
// 사급 통은 처음부터 실값이다. 도급·판금 통은 아직 「발주서로 설명되지 않는 조정치」라서
// 남음 = 발주 입고 + 조정치 − 나감 으로 센다. 「굳히기」(설계 5절)를 누르면 그 회사·갈래의
// 통이 실값이 되고 그때부터 아래 규칙이 켜진다:
//   · 발주 입고 체크 → 통 +   · 호기 체크 → 통 −(있는 만큼까지만)   · 남음 = 통
// 굳히기 전에는 도급·판금이 예전 셈 그대로다 — 두 셈을 섞으면 두 번 센다.
//
// 설정(settings/paidSets)에 { [회사]: { stockLedger: { paid: true, made: true } } } 로 적힌다.

export function ledgerOn(settings, company, kind) {
  if (kind === 'free') return true;
  return !!settings?.[company]?.stockLedger?.[kind];
}

/** BOM 줄의 갈래 키 — kindOf 와 같지만 통 이름으로 쓰기 좋게 여기 한 번 더 */
export function stockKindOf(row) {
  const t = row?.supplyType || '';
  return t === 'made' ? 'made' : t === 'free' ? 'free' : 'paid';
}
