// 자재 이력 — 호기 줄마다 «왜 없나 / 어떻게 채웠나»를 한 줄씩 남긴다. (2026-09-15 대표님)
//
// 「현재 없는건 없는 이유가 남아야하고 그걸 채우면 어떻게 채웠는지가 남아야하는데」
//
// 기록은 «그 호기의 그 줄»(panelMaterials.items[rowId].log[]) 에 붙고, 「자재 이력」 탭이
// 모든 호기를 모아 한 표로 본다. 새 표를 만들지 않는다.
//
// 한 줄 = { id, kind, why, n, at, by, note, mate }
//   kind  'out'  수량이 줄었다      why: 불량 · 파손 · 분실 · 가져감 · 그냥 빼기
//         'in'   수량이 늘었다      why: 구매 · 가져옴 · 수리 입고
//         'why'  수량 그대로, 까닭만 why: 미입고 · 가져감 · 제외   (짝: 가져옴)
//   mate  상대 호기 id — 가져감·가져옴일 때. 고객사에서 가져간 경우처럼 상대가 호기가 아니면 비워 두고 비고에 적는다
//
// 낱말은 「가져감 / 가져옴」으로 통일 — 「차용」은 받은 쪽·준 쪽이 헷갈렸다
// (2026-09-16 대표님 「차용 단어를 가져감 가져옴 으로 확실하게 전체 변경 하자」).
//   가져감: 내 줄에서 다른 호기가 가져갔다 (out)  ·  가져옴: 다른 호기에서 내 줄로 가져왔다 (in)
//
// 짝 기록: 한쪽에서 가져감·가져옴을 고르면 상대 호기 줄에도 짝 한 줄이 같이 남고 수량도 앱이 맞춘다
// (대표님 「둘중 하나만 체크가 되어도 둘다 기록이 남는것 이게맞나?」 → 그렇다).

// 「불량」은 물건 자체가 못 쓰는 것(수리·교환 대상), 「파손」은 다루다 깨진 것 — 갈라 둔다
// (2026-09-15 대표님 「리스트에 불량도 하나 넣어줘」)
// 감소 창 선택지 — 사유 창과 같은 셋으로 통일 (2026-09-17 대표님 「선택지는 사유와 동일하게」).
// 「미입고」 = 안 들어온 것을 채운 걸로 잘못 표시했던 것 → 실물은 통으로 돌아간다.
// 옛 기록의 불량·파손·분실은 그 낱말 그대로 보인다(뜻이 다르니 바꾸지 않는다).
export const OUT_WHYS = ['미입고', '가져감', '제외'];
export const IN_WHYS = ['구매', '가져옴', '수리 입고'];
// 「가져옴」(받았다)은 채우는 창에만 둔다 — 모자란 까닭에 「받았나요」를 물으면 말이 안 된다
// (2026-09-16 대표님 「왜 모자란가요 해놓고 어느호기에서 받았나요는 아니지않음?」)
// 「뒤 호기가 가져감」이라 길게 적지 않는다 — 그냥 「가져감」 (2026-09-16 대표님)
// 아직 «한 번도 안 들어온» 줄의 까닭이라 셋뿐이다 — 불량·파손·분실은 들어온 뒤에 생기는 일이라
// 수량이 줄고, 그건 「왜 줄었나요」(OUT_WHYS) 가 받는다 (2026-09-16 대표님 「사유에는 미입고
// 가져감 제외 만 있어도될듯」). 옛 기록에 남은 불량·파손·분실은 그대로 읽힌다.
// 「제외」는 수량이 아니라 «이 호기에서는 안 쓴다»는 표시다.
// 사유 창 — 「가져감」은 뺐다. 사유는 수량을 안 건드리는데 「앞 호기가 가져감」이라 적으면 앞 호기엔
// 기록만 남고 수량이 0 이라 어긋났다. 실물이 옮겨 간 것은 입고 뒤 「빼기 → 가져감」으로만 —
// 그 길은 양쪽 수량이 같이 움직인다 (2026-09-17 대표님 「가져가는 기능은 입고 후에 빼기만」).
// 옛 사유 기록의 「가져감」은 그대로 읽힌다.
export const WHY_WHYS = ['미입고', '제외'];

// 옛 낱말 — 이미 저장된 기록에 남아 있어 «읽을 때만» 새 낱말로 맞춘다. 기록 자체는 고치지 않는다.
const OLD_WHY = {
  out: { '차용해 줌': '가져감', '그냥 빼기': '미입고' },
  in: { 차용: '가져옴' },
  why: {
    차용: '가져감',
    '앞호기 차용': '가져감',
    '뒤 호기가 가져감': '가져감',
    '뒤호기에 차용해 줌': '가져옴',
    '앞 호기에서 가져옴': '가져옴',
  },
};
export const whyOf = (log) => OLD_WHY[log?.kind]?.[log?.why] || log?.why;

/** 이력 한 줄에 쓰는 짧은 호기 이름 — 「YS-TEPS0926468」 → 「468」 (2026-09-16 대표님 「호기수 뒷 3자리만 표시」) */
export function shortPanel(name) {
  const m = String(name || '').match(/(\d{3})$/);
  return m ? m[1] : String(name || '');
}

/**
 * 상대 호기를 «고를 수 있는» 까닭인가 — 고르면 양쪽이 이어지고, 안 고르면 이 줄에만 남는다.
 * 고객사에서 빌려 간 경우처럼 상대가 호기가 아닐 수 있어 고르기를 강요하지 않는다
 * (2026-09-15 대표님 「고객사에서 빌려간경우도 있어서 호기 미선택시 비고 사유 적기만 해도 ok」).
 */
export function needsMate(kind, why) {
  const w = whyOf({ kind, why });
  if (kind === 'out') return w === '가져감';
  if (kind === 'in') return w === '가져옴';
  return w === '가져감';
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

/** 한쪽에서 가져감·가져옴을 고르면 상대 호기에 남을 짝 — 없으면 null */
export function mateLog(log, myPanelId) {
  if (!log?.mate) return null;
  const w = whyOf(log);
  if (log.kind === 'out' && w === '가져감') {
    return {
      ...newLog({ kind: 'in', why: '가져옴', n: log.n, mate: myPanelId, at: log.at, by: log.by }),
      pair: log.id,
    };
  }
  if (log.kind === 'in' && w === '가져옴') {
    return {
      ...newLog({ kind: 'out', why: '가져감', n: log.n, mate: myPanelId, at: log.at, by: log.by }),
      pair: log.id,
    };
  }
  if (log.kind === 'why' && w === '가져감') {
    // 수량은 안 건드리고 기록만 — 가져간 호기에도 「가져옴」을 남긴다
    return {
      ...newLog({ kind: 'why', why: '가져옴', n: log.n, mate: myPanelId, at: log.at, by: log.by }),
      pair: log.id,
    };
  }
  return null;
}

/** 상대 호기 줄 수량이 얼마나 움직이나 — 기록만 남는 경우는 0 */
export function mateDelta(log) {
  if (!log?.mate) return 0;
  const w = whyOf(log);
  if (log.kind === 'out' && w === '가져감') return +log.n; // 상대가 가져간 만큼 상대 줄이 늘어남
  if (log.kind === 'in' && w === '가져옴') return -log.n; // 내가 가져온 만큼 상대가 빚짐
  return 0;
}

/** 한 줄 요약 — 「파손 1」 「209에서 가져옴 1」 「207가 가져감 1」 */
export function logLabel(log, name = (id) => id) {
  const who = log.mate ? name(log.mate) : '';
  const w = whyOf(log);
  if (log.kind === 'out' && w === '가져감') return who ? `${who}가 가져감 ${log.n}` : `가져감 ${log.n}`;
  if (log.kind === 'in' && w === '가져옴') return who ? `${who}에서 가져옴 ${log.n}` : `가져옴 ${log.n}`;
  if (log.kind === 'why' && w === '가져감') return who ? `${who}가 가져감` : '가져감';
  if (log.kind === 'why' && w === '가져옴') return who ? `${who}에서 가져옴` : '가져옴';
  if (log.kind === 'why') return w;
  return `${w} ${log.n}`;
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
