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
// 사급은 칸(고객사 / 당사)을 주면 «그 칸 몫»으로만 되짚는다 — 지금 그 칸 수량에서 시작한다
// (2026-09-16 대표님 「사급재고 기록 고객사와당사 공유x」).
//
// 앱을 거치지 않고 고친 값이 있으면 아래쪽이 어긋날 수 있다 — 그때 음수가 나와 눈에 띈다.

import { sideShare } from './stockSide';

/** 이 줄이 통을 얼마나 움직였나 (기록만 한 것은 0, 덮어쓴 줄은 null) */
export function deltaOf(l, side = null) {
  const kind = String(l?.kind || '');
  if (kind === 'fix') return null; // 덮어쓰기 — 델타로 못 센다
  const n = sideShare(l, side).n;
  if (kind === 'out') return -n;
  if (kind.startsWith('po-')) return l?.applied ? n : 0;
  if (kind === 'in' || kind === 'back') return n;
  return 0;
}

/**
 * 최신순으로 정렬된 기록에 «뒤 수량»을 매겨 돌려준다.
 * @param logs 최신순 배열
 * @param now  지금 통 수량 (칸을 주면 그 칸 수량)
 * @param side 'ours' | 'theirs' — 사급에서 볼 칸. 안 주면 통 전체
 * @returns [{ ...log, share, after }] — share 는 그 칸 몫, after 는 그 줄 직후의 수량
 *          (어느 칸인지 모르는 옛 손맞춤 밑으로는 되짚을 수 없어 after 가 null 이 된다)
 */
export function withRunning(logs, now, side = null) {
  let running = Math.max(0, Number(now) || 0);
  let lost = false; // 되짚기가 끊겼나
  const out = [];
  for (const l of logs || []) {
    const s = sideShare(l, side);
    out.push({ ...l, share: s.n, whole: s.whole !== false, after: lost ? null : running });
    if (lost) continue;
    if (String(l?.kind) === 'fix') {
      // 칸을 모르는 옛 줄은 두 칸 합계를 고친 것이라 이 칸 수량을 못 집어낸다 — 여기서 끊는다
      if (side && !l?.side) {
        lost = true;
        continue;
      }
      running = Math.max(0, Number(l?.from) || 0);
      continue;
    }
    running -= Number(deltaOf(l, side)) || 0;
  }
  return out;
}
