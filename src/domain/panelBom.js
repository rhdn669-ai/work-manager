// 판넬(호기) ↔ BOM 연결 (2026-09-03 대표님 「생산 현황에 호기별로 자재 사급 도급 리스트를」).
//
// 판넬 문서의 bomLink 한 필드에 담는다.
//   { projectId, projectName, variantKey, variantLabel }
// BOX 는 대응표가 필요 없다 — 판넬과 BOM 이 같은 이름을 쓴다(domain/boxes.js).
// projectName·variantLabel 은 표시용 스냅샷이다. BOM 쪽에서 이름을 고치면 다음에
// 연결 화면을 열 때 갱신된다 — 연결 자체는 id 로 붙들어 이름이 바뀌어도 끊기지 않는다.

import { PANEL_BOXES, EXTRA_BOXES } from './boxes';

/**
 * 호기 자재 체크 대상 BOX — 차례는 BOM 표와 같다(domain/boxes 의 BOX_OPTIONS).
 *  · 「준비작업」·「LOCAL」은 실물 BOX 는 아니지만 BOM 에 줄이 있어 체크해야 한다
 *    (2026-09-05 대표님 「로컬 준비작업 둘 다 들어와야」). 전에는 이 둘을 맨 «앞»에 두어
 *    BOM 표(맨 뒤)와 차례가 어긋났다 — 같은 자재를 두 화면에서 다른 순서로 찾아야 했다
 *    (2026-09-22 대표님 「재고 호기 체크쪽도 bom이랑 순서 맞춰줄수있음?」).
 *  · MP 도 넣는다 — BOM 에 MP 사급 줄이 있다. 생산현황의 MP 하위 9종(조립 진행)과는 별개로
 *    「무엇이 들어왔나」만 본다 (2026-09-05 대표님 「리스트에 아직 MP 가 없네」)
 */
export const CHECKABLE_BOXES = [...PANEL_BOXES, ...EXTRA_BOXES];

/** 연결이 되어 있나 */
export function hasBomLink(p) {
  return !!(p && p.bomLink && p.bomLink.projectId);
}

/** 판넬에 저장할 연결 값 — 빈 값을 지우고 형태를 고정한다 */
export function makeBomLink({ projectId, projectName, variantKey, variantLabel }) {
  if (!projectId) return null;
  return {
    projectId,
    projectName: String(projectName || '').trim(),
    variantKey: variantKey || '',
    variantLabel: String(variantLabel || '').trim(),
  };
}

/**
 * 「이 설정 복사」 대상 — 같은 회사 탭의 다른 호기.
 *
 * 프로젝트명이 같은 것만 고르려 했는데, 실제 데이터는 호기마다 프로젝트명이 다르다
 * (YS-TEPS0926165 · YS-TEPS0926167 …). 그래서 같은 회사의 다른 판넬을 전부 대상으로
 * 하고, 이미 같은 연결인 것과 자기 자신만 뺀다. 몇 개인지 버튼에 보이므로 누르기 전에
 * 알 수 있다.
 */
export function siblingsForCopy(panels, me) {
  if (!me) return [];
  return (panels || []).filter(
    (q) =>
      q.id !== me.id &&
      (q.회사 || '') === (me.회사 || '') &&
      !(
        q.bomLink &&
        me.bomLink &&
        q.bomLink.projectId === me.bomLink.projectId &&
        (q.bomLink.variantKey || '') === (me.bomLink.variantKey || '')
      ),
  );
}

/** BOM 줄 가운데 이 판넬의 이 BOX 에 해당하는 것 — 타입은 bomItemsForVariant 가 거른 뒤 */
// ── 정·역 구분 (2026-09-21 대표님 「정역 공통 정,역 개별로 체크」) ──
// BOM 줄마다 「정」「역」을 켜고 끈다. 둘 다 켜짐 = 공통(어느 호기나 쓴다). 하나만 켜면 그 방향
// 호기에서만 셈에 들고, 반대쪽 호기 화면에는 «회색으로 보이되 셈에는 없는» 줄이 된다 —
// 완료 판정·부족 집계·나감 SET·재고 통 모두. 숨기지 않고 회색으로 두는 것은 예전과 같다
// (「넘기기보다 우리쪽으로 아예 입고가 안될거라」 → 「제외」 단추는 안 먹음).
//
// 전에는 「정방향 제외」(skipForward) 한 가지뿐이라 «정방향에만 쓰는 자재»를 적을 길이 없었다.
// 옛 값은 「역만」으로 읽는다 — 저장된 자료는 손대지 않는다 (2026-09-15 → 2026-09-21).
export const DIRS = ['정', '역'];

/** 이 줄이 허용하는 방향 — 빈 배열이면 공통(둘 다). 한 가지만 켜졌을 때만 값이 찬다 */
export function dirsOf(row) {
  if (Array.isArray(row?.dirs)) {
    const uniq = [...new Set(row.dirs.map((d) => String(d).trim()).filter((d) => DIRS.includes(d)))];
    return uniq.length === 1 ? uniq : []; // 둘 다거나 하나도 없으면 공통
  }
  return row?.skipForward ? ['역'] : []; // 옛 「정방향 제외」 = 역방향에서만 쓰는 줄
}

// ── 방향마다 셋: 셈 / 안 셈 / 없음 (2026-09-22 대표님 「정방향만 쓰는데 수량 체크를 안하는 선택지는?」) ──
// 처음에는 «한 방향만 특별하고 반대쪽은 정상»만 적을 수 있게 다섯 가지를 두었는데, 「정방향만
// 쓰는데 그것도 우리가 안 세는」 자재처럼 «두 방향이 서로 다른 상태»가 실제로 있었다.
// 그래서 방향마다 따로 적는다 — 조합 여덟 가지가 모두 표현된다.
//   use   셈      — 우리가 챙기고 수량을 센다
//   gray  안 셈   — 쓰긴 쓰는데 우리가 수량을 안 센다. 목록에 회색으로 남는다
//   none  없음    — 그 방향엔 아예 안 들어간다. 목록에 안 뜬다
//
// 저장은 dirState 한 칸에 하고, 옛 칸(dirs·dirHide·skipForward)은 손대지 않는다 — 읽을 때만
// 폴백으로 본다. 그래서 저장된 자료를 옮기지 않아도 동작이 그대로다.
export const DIR_STATES = [
  { value: 'use', label: '셈', hint: '우리가 챙기고 수량을 셉니다' },
  { value: 'gray', label: '안셈', hint: '쓰긴 쓰는데 우리가 수량을 안 셉니다 — 목록에 회색으로 남습니다' },
  { value: 'none', label: '없음', hint: '그 방향 호기에는 아예 안 들어갑니다 — 목록에 안 뜹니다' },
];
const STATE_VALUES = DIR_STATES.map((x) => x.value);

/** 이 줄의 방향별 상태 — 옛 모양(dirs·dirHide·skipForward)도 같은 함수로 읽는다 */
export function dirStateOf(row) {
  const st = row?.dirState;
  if (st && typeof st === 'object' && !Array.isArray(st)) {
    const pick = (d) => (STATE_VALUES.includes(st[d]) ? st[d] : 'use');
    return { 정: pick('정'), 역: pick('역') };
  }
  const dirs = dirsOf(row);
  if (dirs.length === 0) return { 정: 'use', 역: 'use' };
  const off = row?.dirHide ? 'none' : 'gray';
  // dirs 에 남은 쪽이 «쓰는 방향»이고, 빠지는 쪽이 회색이거나 없음이다
  return dirs.includes('정') ? { 정: 'use', 역: off } : { 정: off, 역: 'use' };
}

/** 고른 값을 줄에 적을 모양으로 */
export function dirStatePatch(state) {
  const pick = (d) => (STATE_VALUES.includes(state?.[d]) ? state[d] : 'use');
  return { dirState: { 정: pick('정'), 역: pick('역') } };
}

/** 한 방향의 설명 한 줄 */
export function dirStateHint(value) {
  return DIR_STATES.find((x) => x.value === value)?.hint || '';
}

/** 공통인가 — 둘 다 셈하면 기본값이라 화면에서 조용히 둔다 */
export function isDirCommon(row) {
  const st = dirStateOf(row);
  return st.정 === 'use' && st.역 === 'use';
}

/** 이 호기에서 셈에 안 넣는 줄 — 호기에 정역을 안 적었으면 «모름»이라 빼지 않는다(빼는 쪽이 위험) */
export function isOutOfScope(row, panel) {
  const d = String(panel?.정역 || '').trim();
  if (!DIRS.includes(d)) return false;
  return dirStateOf(row)[d] !== 'use';
}

/** 이 호기에서 「안셈」인 줄인가 — 쓰긴 쓰는데 우리가 수량을 안 센다 */
export function isGrayForPanel(row, panel) {
  const d = String(panel?.정역 || '').trim();
  if (!DIRS.includes(d)) return false;
  return dirStateOf(row)[d] === 'gray';
}

/** 이 호기의 목록에서 아예 빼는 줄인가 — 「없음」으로 정한 방향만 */
export function isHiddenForPanel(row, panel) {
  const d = String(panel?.정역 || '').trim();
  if (!DIRS.includes(d)) return false;
  return dirStateOf(row)[d] === 'none';
}

// ── 타입별 수량 (2026-09-21 대표님 「타입별로 수량을 다르게 적을수있게」) ──
// 같은 품목인데 타입마다 개수가 다를 때, 전에는 줄을 둘로 쪼개고 줄마다 타입을 체크해야 했다.
// 이제 한 줄에 «기본 수량 + 다른 타입만 예외»로 적는다 — 예: 기본 8, M7H 7.
// 예외에 0 을 적으면 그 타입에는 없는 자재다. 기본을 비우면(0) 타입을 안 정한 호기에는 안 뜬다
// (대표님 「공통이 없는건 우선 기본값을 비우고」).
//
// 옛 모양(타입 전용 줄 = variantKeys)도 같은 함수로 읽는다 — 자료를 안 옮겨도 동작이 그대로다.
const byVariantOf = (row) => {
  const by = row?.qtyByVariant;
  return by && typeof by === 'object' && !Array.isArray(by) ? by : null;
};

/** 이 타입에서 이 줄이 몇 개 필요한가 — 0 이면 그 타입 호기에는 없는 줄 */
export function qtyForVariant(row, variantKey) {
  const key = String(variantKey || '').trim();
  const base = Math.max(0, Number(row?.qty) || 0);
  const by = byVariantOf(row);
  if (by) {
    if (key && Object.prototype.hasOwnProperty.call(by, key)) return Math.max(0, Number(by[key]) || 0);
    return base;
  }
  const ks = Array.isArray(row?.variantKeys) ? row.variantKeys : [];
  if (key && ks.length > 0 && !ks.includes(key)) return 0;
  return base;
}

/** 이 타입 호기의 자재 목록에 뜨는 줄인가 */
export function rowInVariant(row, variantKey) {
  if (byVariantOf(row)) return qtyForVariant(row, variantKey) > 0;
  const key = String(variantKey || '').trim();
  const ks = Array.isArray(row?.variantKeys) ? row.variantKeys : [];
  return !(key && ks.length > 0 && !ks.includes(key));
}

/** 타입에 맞는 줄만 — 수량도 그 타입 값으로 바꿔서 준다.
 *  받는 쪽(호기 체크·부족 집계·재고 나감·발주서)은 전처럼 row.qty 만 보면 된다. */
export function rowsForVariant(rows, variantKey) {
  return (rows || [])
    .filter((r) => rowInVariant(r, variantKey))
    .map((r) => {
      const q = qtyForVariant(r, variantKey);
      return q === (Number(r.qty) || 0) ? r : { ...r, qty: q };
    });
}

/** 이 줄에 적힌 «기본과 다른» 타입별 수량 — [{ key, qty }] (BOM 표에 작게 보여 준다) */
export function variantQtyList(row) {
  const by = byVariantOf(row);
  if (!by) return [];
  const base = Math.max(0, Number(row?.qty) || 0);
  return Object.keys(by)
    .map((key) => ({ key, qty: Math.max(0, Number(by[key]) || 0) }))
    .filter((v) => v.qty !== base);
}

/** 이 호기가 실제로 쓰는 줄 — 타입(형번)에 맞고, 이 호기 방향에 해당하는 것 */
export function rowsForPanel(rows, panel) {
  const key = panel?.bomLink?.variantKey || '';
  return rowsForVariant(rows, key).filter((r) => !isOutOfScope(r, panel));
}

export function bomRowsForBox(rows, box) {
  const b = String(box || '').trim();
  return (rows || []).filter((r) => String(r.box || '').trim() === b);
}

/**
 * 회사의 기본 BOM 프로젝트 — 그 회사 호기들이 가장 많이 연결한 프로젝트.
 * 표의 「자재」 칸에서 타입을 고르면 연결이 없는 호기는 이 프로젝트로 붙는다.
 */
export function defaultBomProjectId(panels, bomProjects = [], company = '') {
  const count = new Map();
  for (const p of panels || []) {
    const id = p?.bomLink?.projectId;
    if (id) count.set(id, (count.get(id) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [id, c] of count) if (c > n) [best, n] = [id, c];
  if (best) return best;

  // 아직 한 대도 안 붙은 회사 — 이름에 회사가 들어간 BOM 을 기본으로 삼는다.
  //
  // 「자재」 칸은 «가장 많이 쓰는 BOM» 을 첫 호기에 붙여 주는데, 한 대도 안 붙어 있으면
  // 그 기준이 없어 눌러도 아무 일이 안 났다. 디에이치는 BOM 을 다 만들어 두고도 호기
  // 192 대가 전부 연결되지 않았다 (2026-09-11 대표님 「디에이치 BOM 만들었는데 연동이 안되네」).
  const c = String(company || '').trim();
  if (!c) return '';
  const hit = (bomProjects || []).find((x) => String(x?.name || '').includes(c));
  return hit ? hit.id : '';
}

/** 호기의 「자재」 칸에 보일 타입 목록 — 연결된 프로젝트의 타입, 없으면 기본 프로젝트의 타입 */
export function variantOptionsFor(panel, bomProjects, defaultProjectId) {
  const pid = panel?.bomLink?.projectId || defaultProjectId || '';
  const proj = (bomProjects || []).find((x) => x.id === pid);
  if (!proj) return { project: null, options: [] };
  return {
    project: proj,
    options: (Array.isArray(proj.variants) ? proj.variants : []).map((v) => ({ key: v.key, label: v.label })),
  };
}

/** 「자재」 칸에 보일 글자 — 연결된 타입이 우선, 없으면 손으로 적은 자재 */
export function variantLabelOf(panel) {
  return panel?.bomLink?.variantLabel || panel?.자재 || '';
}

/**
 * 자재를 세기 시작한 호기인가 — 수량을 하나라도 적어 넣었으면 세는 중이다.
 *
 * 처음에는 사람이 「시작」을 누르게 했는데, 이미 체크 중이거나 다 끝난 호기에도 그 단추가
 * 떠서 이상했다 (2026-09-14 대표님 「사급 이미 체크중인것,완료된것도 시작버튼 왜띄움?」).
 * 누르는 수고도 없앤다 — 리스트에서 수량을 넣는 순간 저절로 센다
 * (대표님 「대기 버튼으로 해두고 리스트에서 수량 입력하면 카운트하는걸로」).
 *
 * @param mats 그 호기의 자재 기록 { [box]: { [줄id]: { qty } } }
 */
export function isMatStarted(mats) {
  for (const box of Object.values(mats || {})) {
    if (!box || typeof box !== 'object') continue;
    for (const r of Object.values(box)) {
      if (Number(r?.qty) > 0) return true;
    }
  }
  return false;
}
