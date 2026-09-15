// 분실·파손 장부 — «사건 하나 = 줄 하나». (2026-09-15 대표님 「분실 파손 이력 탭하나를 만들고 거기서 운용」)
//
// 호기를 만들다 부품이 파손·분실되면 뒤 호기에서 하나 빌려 온다. 그 사건을 «사건이 난 호기의
// 그 줄 기록»(panelMaterials.items[rowId].incidents[]) 에 남기고, 「분실·파손」 탭이 모든 호기
// 기록을 모아 한 표로 보여 준다. 새 표를 만들지 않는다.
//
// 숫자 규칙
//   · 호기 수량 = 붙어 있는 멀쩡한 부품 수. 사건이 난 호기는 수량 그대로
//   · 빌려온 호기(from)를 고르면 그 호기 그 줄 수량이 −n → 부족 집계에 저절로 뜬다
//     안 고르면 사건 난 호기 줄이 −n (빈자리가 여기)
//   · 통은 안 움직인다. 파손품이 수리돼 돌아오면(「수리 입고」) 통 +n. 분실은 재구매가 통을
//     올리므로 「입고됨」으로 닫기만 한다

export const REASONS = ['파손', '분실'];

/** 사건 하나 — 저장 모양 */
export function newIncident({ id, reason = '파손', n = 1, from = '', at, by = '', note = '' }) {
  return {
    id: id || `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    reason: REASONS.includes(reason) ? reason : '파손',
    n: Math.max(1, Number(n) || 1),
    from: from || '', // 빌려온 호기 id — 없으면 빈자리는 사건 난 호기
    at: at || new Date().toISOString().slice(0, 10),
    by,
    note: String(note || '').trim(),
    status: 'open', // open → done (수리 입고 / 입고됨)
  };
}

export function isOpen(inc) {
  return (inc?.status || 'open') === 'open';
}

/** 상태 글자 — 열려 있으면 사유에 따라, 닫혔으면 「종료」 */
export function statusLabel(inc) {
  if (!isOpen(inc)) return inc.reason === '파손' ? '수리 입고' : '입고됨';
  return inc.reason === '파손' ? '수리 대기' : '재구매 대기';
}

/**
 * 모든 호기 기록에서 사건을 모은다 — 탭이 쓴다.
 * @returns [{ panelId, box, rowId, inc }] 최신순
 */
export function allIncidents(allMaterials) {
  const out = [];
  for (const [panelId, boxes] of Object.entries(allMaterials || {})) {
    for (const [box, items] of Object.entries(boxes || {})) {
      for (const [rowId, rec] of Object.entries(items || {})) {
        for (const inc of rec?.incidents || []) out.push({ panelId, box, rowId, inc });
      }
    }
  }
  return out.sort((a, b) => String(b.inc.at || '').localeCompare(String(a.inc.at || '')) || (isOpen(a.inc) ? -1 : 1));
}

/**
 * 이 호기·이 줄에 걸린 사건 — 호기 체크 줄의 작은 표시가 쓴다.
 *   mine  이 호기에서 난 사건
 *   lent  이 호기가 빌려준 사건 (다른 호기에서 났고 from 이 나)
 */
export function incidentsForRow(allMaterials, box, rowId, panelId) {
  const mine = [];
  const lent = [];
  for (const [pid, boxes] of Object.entries(allMaterials || {})) {
    const list = boxes?.[box]?.[rowId]?.incidents;
    if (!Array.isArray(list)) continue;
    for (const inc of list) {
      if (pid === panelId) mine.push(inc);
      else if (inc.from === panelId) lent.push({ ...inc, panelId: pid });
    }
  }
  return { mine, lent };
}

/** 호기 체크 줄에 붙는 한 줄 — 「파손 1 · 수리 대기」 / 「207에 빌려줌 1」 */
export function rowIncidentLabel({ mine = [], lent = [] }, name = (id) => id) {
  const parts = [];
  for (const inc of mine) parts.push(`${inc.reason} ${inc.n}${isOpen(inc) ? ` · ${statusLabel(inc)}` : ''}`);
  for (const inc of lent) parts.push(`${name(inc.panelId)}에 빌려줌 ${inc.n}`);
  return parts.join(' · ');
}
