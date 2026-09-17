// 줄을 «처음 상태»로 되돌릴 때 무엇이 어디로 가는가 — 순수 셈.
// (2026-09-17 대표님 「입고 기록에 취소 하나 만들고 누르면 처음 대기상태로 돌아가는 버튼」)
//
//   다른 호기에서 가져온 몫(in · 가져옴 · mate)  → 그 호기로 돌아간다. 통에서 온 몫 표시(fromStock)도
//                                                그 호기로 딸려 간다 — 안 그러면 그 호기가 나중에 빼도
//                                                통으로 못 돌아가 장부에서 사라진다 (야간 조사 S5)
//   남은 통 몫(fromStock 나머지)                  → 재고 통으로 돌아간다 (당사가 댄 몫은 그만큼 당사로)
//   이 줄에서 남에게 «보낸» 것(out · 가져감)     → 실물이 거기 있으니 되돌리지 않는다. 알려만 준다
//   기록 전부                                     → 휴지통으로
import { whyOf } from './matLog';

export function undoPlan(rec) {
  const qty = Math.max(0, Number(rec?.qty) || 0);
  // 통에서 온 몫은 지금 수량을 넘지 못한다 — 넘는 값은 앱 밖에서 고친 흔적
  let fromStock = Math.min(qty, Math.max(0, Number(rec?.fromStock) || 0));
  const fromOurs = Math.max(0, Number(rec?.fromOurs) || 0);
  const logs = Array.isArray(rec?.log) ? rec.log : [];
  const toMates = [];
  const kept = [];
  for (const l of logs) {
    if (!l?.mate) continue;
    const w = whyOf(l);
    const n = Math.max(0, Number(l.n) || 0);
    if (l.kind === 'in' && w === '가져옴') {
      const fs = Math.min(fromStock, n);
      fromStock -= fs;
      toMates.push({ mate: l.mate, n, fromStock: fs });
    } else if (l.kind === 'out' && w === '가져감') {
      kept.push({ mate: l.mate, n });
    }
  }
  const toStock = fromStock;
  return {
    qty,
    toMates, // [{ mate, n, fromStock }]
    kept, // [{ mate, n }] — 되돌리지 않는 것
    toStock,
    tookOurs: Math.min(fromOurs, toStock),
    logs,
    tookFromMates: toMates.reduce((a, m) => a + m.n, 0),
  };
}
