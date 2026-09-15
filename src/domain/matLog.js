// 자재 이력 — 호기 줄마다 «왜 없나 / 어떻게 채웠나»를 한 줄씩 남긴다. (2026-09-15 대표님)
//
// 「현재 없는건 없는 이유가 남아야하고 그걸 채우면 어떻게 채웠는지가 남아야하는데」
//
// 기록은 «그 호기의 그 줄»(panelMaterials.items[rowId].log[]) 에 붙고, 「자재 이력」 탭이
// 모든 호기를 모아 한 표로 본다. 새 표를 만들지 않는다.
//
// 한 줄 = { id, kind, why, n, at, by, note, mate }
//   kind  'out'  수량이 줄었다      why: 파손 · 분실 · 차용해 줌 · 그냥 빼기
//         'in'   수량이 늘었다      why: 구매 · 차용 · 수리 입고
//         'why'  수량 그대로, 까닭만 why: 미입고 · 앞호기 차용 · 파손 · 분실
//   mate  상대 호기 id — 차용·빌려줌·앞호기 차용일 때
//
// 짝 기록: 한쪽에서 차용을 고르면 상대 호기 줄에도 짝 한 줄이 같이 남고 수량도 앱이 맞춘다
// (대표님 「둘중 하나만 체크가 되어도 둘다 기록이 남는것 이게맞나?」 → 그렇다).

export const OUT_WHYS = ['파손', '분실', '차용해 줌', '그냥 빼기'];
export const IN_WHYS = ['구매', '차용', '수리 입고'];
export const WHY_WHYS = ['미입고', '앞호기 차용', '파손', '분실'];

/** 상대 호기를 골라야 하는 까닭인가 */
export function needsMate(kind, why) {
  if (kind === 'out') return why === '차용해 줌';
  if (kind === 'in') return why === '차용';
  return why === '앞호기 차용';
}

/** 재고 통에서 실물이 나가야 하는 까닭인가 — 통이 비면 못 채운다 (대표님 「재고에서는 수량이 있어야」) */
export function needsStock(kind, why) {
  return kind === 'in' && (why === '구매' || why === '수리 입고');
}

export function newLog({ id, kind, why, n = 1, mate = '', at, by = '', note = '' }) {
  return {
    id: id || `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    why,
    n: Math.max(1, Number(n) || 1),
    mate: mate || '',
    at: at || new Date().toISOString().slice(0, 10),
    by,
    note: String(note || '').trim(),
  };
}

/** 한쪽에서 차용을 고르면 상대 호기에 남을 짝 — 없으면 null */
export function mateLog(log, myPanelId) {
  if (!log?.mate) return null;
  if (log.kind === 'out' && log.why === '차용해 줌') {
    return { ...newLog({ kind: 'in', why: '차용', n: log.n, mate: myPanelId, at: log.at, by: log.by }), pair: log.id };
  }
  if (log.kind === 'in' && log.why === '차용') {
    return {
      ...newLog({ kind: 'out', why: '차용해 줌', n: log.n, mate: myPanelId, at: log.at, by: log.by }),
      pair: log.id,
    };
  }
  if (log.kind === 'why' && log.why === '앞호기 차용') {
    // 수량은 안 건드리고 기록만 — 상대 호기에도 「가져갔다」를 남긴다
    return {
      ...newLog({ kind: 'why', why: '뒤호기에 차용해 줌', n: log.n, mate: myPanelId, at: log.at, by: log.by }),
      pair: log.id,
    };
  }
  return null;
}

/** 상대 호기 줄 수량이 얼마나 움직이나 — 기록만 남는 경우는 0 */
export function mateDelta(log) {
  if (!log?.mate) return 0;
  if (log.kind === 'out' && log.why === '차용해 줌') return +log.n; // 내가 준 만큼 상대가 받음
  if (log.kind === 'in' && log.why === '차용') return -log.n; // 내가 받은 만큼 상대가 빚짐
  return 0;
}

/** 한 줄 요약 — 「파손 1」 「209에서 차용 1」 「207에 빌려줌 1」 */
export function logLabel(log, name = (id) => id) {
  const who = log.mate ? name(log.mate) : '';
  if (log.kind === 'out' && log.why === '차용해 줌') return `${who}에 빌려줌 ${log.n}`;
  if (log.kind === 'in' && log.why === '차용') return `${who}에서 차용 ${log.n}`;
  if (log.kind === 'why' && log.why === '앞호기 차용') return `${who} 차용`;
  if (log.kind === 'why' && log.why === '뒤호기에 차용해 줌') return `${who}에 차용해 줌`;
  if (log.kind === 'why') return log.why;
  return `${log.why} ${log.n}`;
}

/** 이 줄의 지금 상태 한 줄 — 「왜 없나 → 어떻게 채웠나」 */
export function rowSummary(logs = [], name = (id) => id) {
  const last = [...logs].sort(
    (a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)),
  );
  const why = [...last].reverse().find((l) => l.kind === 'why' || l.kind === 'out');
  const fill = [...last].reverse().find((l) => l.kind === 'in');
  const parts = [];
  if (why) parts.push(logLabel(why, name));
  if (fill) parts.push(`→ ${logLabel(fill, name)}`);
  return parts.join(' ');
}

/** 모든 호기 기록을 모아 최신순 — 「자재 이력」 탭이 쓴다 */
export function allLogs(allMaterials) {
  const out = [];
  for (const [panelId, boxes] of Object.entries(allMaterials || {})) {
    for (const [box, items] of Object.entries(boxes || {})) {
      for (const [rowId, rec] of Object.entries(items || {})) {
        for (const log of rec?.log || []) out.push({ panelId, box, rowId, log });
      }
    }
  }
  return out.sort(
    (a, b) =>
      String(b.log.at || '').localeCompare(String(a.log.at || '')) || String(b.log.id).localeCompare(String(a.log.id)),
  );
}
