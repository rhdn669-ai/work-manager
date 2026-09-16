// 통 기록의 «뒤 수량» — 통장처럼 줄마다 그 뒤의 통 수량을 매긴다.
// (2026-09-16 대표님 「기록에 총수량의 기록도 보여줄수있나?」)
//
// 지금 통 수량에서 거꾸로 되짚는다. 맨 윗줄(가장 최근)의 뒤 수량은 «지금 수량»과 반드시 같고,
// 아래로 내려가며 그 줄이 한 일을 되돌린다.
//   들어옴·되돌림·발주 입고(반영된 것)  + 개수
//   호기로                              − 개수
//   손으로 맞춤                          그 값으로 덮어쓴 것 — 그 앞은 log 의 from 으로 이어 간다
//   발주 입고 「기록만」                  수량을 안 건드렸다
//
// 앱을 거치지 않고 고친 값이 있으면 아래쪽이 어긋날 수 있다 — 그때 음수가 나와 눈에 띈다.

/** 이 줄이 통을 얼마나 움직였나 (기록만 한 것은 0) */
export function deltaOf(l) {
  const n = Number(l?.n) || 0;
  const kind = String(l?.kind || '');
  if (kind === 'fix') return null; // 덮어쓰기 — 델타로 못 센다
  if (kind === 'out') return -n;
  if (kind.startsWith('po-')) return l?.applied ? n : 0;
  if (kind === 'in' || kind === 'back') return n;
  return 0;
}

/**
 * 최신순으로 정렬된 기록에 «뒤 수량»을 매겨 돌려준다.
 * @param logs 최신순 배열
 * @param now  지금 통 수량
 * @returns [{ ...log, after }] — after 는 그 줄 직후의 통 수량
 */
export function withRunning(logs, now) {
  let running = Math.max(0, Number(now) || 0);
  const out = [];
  for (const l of logs || []) {
    out.push({ ...l, after: running });
    if (String(l?.kind) === 'fix') {
      // 덮어쓴 줄 — 그 앞의 수량은 기록에 남은 from 을 쓴다
      running = Math.max(0, Number(l?.from) || 0);
      continue;
    }
    const d = deltaOf(l);
    running -= Number(d) || 0;
  }
  return out;
}
