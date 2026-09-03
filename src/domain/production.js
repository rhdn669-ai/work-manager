import { PANEL_BOXES, normalizeBoxKeys } from './boxes';
// 판넬 생산현황 도메인 모델 — 기존 index.html의 검증된 로직을 이식.
// 화면/DB와 독립. 상태 파생·상수는 전부 여기 한곳에서 관리.

/* ── 부품/공정 상수 ── */
// 부품(BOX·판넬) 6종 — 명판(P/W BOX·S/D·H/T·ROBOT 등)과 동일 도메인
// BOX 이름은 domain/boxes.js 에서 BOM 과 함께 쓴다 (2026-09-03 대표님 「1대1 매칭」)
export const BUPMOK = PANEL_BOXES;
// 자재 입고 항목 — 2단 구조: 판금(단일) · 하네스{사급·제작} · 자재{사급·도급}
export const JAIP_GROUPS = [
  { key: '판금', label: '판금', leaves: [{ key: '판금', label: '판금' }] },
  {
    key: '하네스',
    label: '하네스',
    leaves: [
      { key: '하네스_사급', label: '사급' },
      { key: '하네스_제작', label: '제작' },
    ],
  },
  {
    key: '자재',
    label: '자재',
    leaves: [
      { key: '자재_사급', label: '사급' },
      { key: '자재_도급', label: '도급' },
    ],
  },
];
// 자재입고 leaf 키 목록 (완료·일자·롤업 등 파생은 전부 이 목록 기반)
export const JAIP = JAIP_GROUPS.flatMap((g) => g.leaves.map((l) => l.key));

// 일정 그룹의 "자재입고" 항목별 입고일 — 2단 구조: 판금(단일)·하네스{사급·도급·제작}·자재{사급·도급}
// 상단에 하네스/자재를 묶음 헤더로 표시. BOX별 체크(JAIP)와 별개. (2026-07-27 대표님)
export const IPGO_GROUPS = [
  { key: '판금', label: '판금', leaves: [{ key: '판금', label: '판금' }] },
  {
    key: '하네스',
    label: '하네스',
    leaves: [
      { key: '하네스_사급', label: '사급' },
      { key: '하네스_도급', label: '도급' },
      { key: '하네스_제작', label: '제작' },
    ],
  },
  {
    key: '자재',
    label: '자재',
    leaves: [
      { key: '자재_사급', label: '사급' },
      { key: '자재_도급', label: '도급' },
    ],
  },
];
// 입고일 leaf 키 목록 (본문 셀 렌더 순서 = 헤더 컬럼 순서)
export const IPGO_ITEMS = IPGO_GROUPS.flatMap((g) => g.leaves.map((l) => ({ key: l.key, label: l.label })));
// MP 판넬 하위 10종
export const MP_SUBS = ['PLC', 'I/O', '드라이브', 'INV', 'CN', 'BORAD', 'EMS', 'SWITCH', 'V메타']; // MAIN → 부품 'MP'로 승격 (2026-07-20)
// 진행률에서 MP가 차지하는 고정 비중(12.5%). 하위 9종으로 다시 분할, 나머지 부품은 87.5% 균등.
// 턴온 뒤 마무리 일정 — 표·상세 모달이 같은 정의를 쓴다.
// 현장 흐름 순서 그대로: I/O CHECK → 조정 → 입고검수 → 고객검수 → 출하검수 → 포장 → 출하
//
// key 와 label 을 나눈 이유: Firestore 는 필드 이름에 「/」를 쓸 수 없다
// (Invalid field path. Paths must not contain ~, *, /, [, or ]).
// 화면에는 현장에서 부르는 대로 「I/O CHECK」 라 적고, 저장은 ioCheck 로 한다.
export const AFTER_TURNON = [
  { key: 'ioCheck', label: 'I/O CHECK' },
  { key: '조정', label: '조정' },
  { key: '입고검수', label: '입고검수' },
  { key: '고객검수', label: '고객검수' },
  { key: '출하검수', label: '출하검수' },
  { key: '포장', label: '포장' },
  { key: '출하', label: '출하' },
];
export const AFTER_TURNON_KEYS = AFTER_TURNON.map((f) => f.key);

export const MP_WEIGHT = 0.125;

/* ── 부품 작업 상태 4단계 ── */
export const TASK_STATES = ['대기', '진행중', '완료', '문제'];
// UI 입력용 3종 (2026-07-20 대표님: 대기·완료·불량) — 저장값 '문제'의 표시명은 '불량'
export const UI_TASK_STATES = ['대기', '완료', '문제'];
export const TASK_LABEL = { 대기: '대기', 진행중: '진행중', 완료: '완료', 문제: '불량' };
export const TASK_CFG = {
  대기: { dot: '#8b95a1', bg: 'var(--status-wait-bg)', fg: 'var(--status-wait-fg)' },
  진행중: { dot: '#2272eb', bg: 'var(--status-progress-bg)', fg: 'var(--status-progress-fg)' },
  완료: { dot: '#15803d', bg: 'var(--status-done-bg)', fg: 'var(--status-done-fg)' },
  문제: { dot: '#d6303f', bg: 'var(--status-cancel-bg)', fg: 'var(--status-cancel-fg)' },
  불량: { dot: '#d6303f', bg: 'var(--status-cancel-bg)', fg: 'var(--status-cancel-fg)' }, // 구 데이터 방어(불량=문제)
};

/* ── 종합(overall) 상태 ── */
export const OVERALL_CFG = {
  대기중: { fg: '#6b7684', bg: '#f2f4f6' },
  제작중: { fg: '#c05621', bg: '#fff7ed' },
  보류: { fg: '#c53030', bg: '#fdebec' },
  검수대기: { fg: '#7c3aed', bg: '#f3ecff' },
  검수완료: { fg: '#0987a0', bg: '#e6fffa' },
  출고완료: { fg: '#15803d', bg: '#e7f4ec' },
  출고숨김: { fg: '#8b95a1', bg: '#f2f4f6' },
};
export const OVERALL_ORDER = Object.keys(OVERALL_CFG);

/* ── 발주사 (2026-07 대표님 확정: 메티스·디에이치 2개사 체제) ── */
export const COMPANIES = ['메티스', '디에이치'];
// 기구제작 업체 — 회사별 선택지 (2026-07-21 대표님: 메티스=TSW·엘트, 디에이치=건일·두원)
export const GIGU_MAKERS = { 메티스: ['TSW', '엘트'], 디에이치: ['건일', '두원'] };

/* ── 그룹 색상 (legacy 이식) ── */
export const PROJ_COLORS = ['#667eea', '#48bb78', '#ed8936', '#ed64a6', '#4299e1', '#38b2ac'];
export const NAPGI_COLORS = ['#667eea', '#4299e1', '#48bb78', '#ed8936', '#e53e3e', '#9f7aea', '#0bc5ea', '#dd6b20'];

// 전체 목록 기준으로 납기/그룹에 색 배정
export function napgiColorOf(allNapgi, n) {
  const i = allNapgi.indexOf(n);
  return NAPGI_COLORS[i < 0 ? 0 : i % NAPGI_COLORS.length];
}
export function projColorOf(allGroups, g) {
  const i = allGroups.indexOf(g);
  return PROJ_COLORS[i < 0 ? 0 : i % PROJ_COLORS.length];
}

// 1차/2차 검수에서 미해결 불량이 있는 부품 목록 (legacy 이식)
export function unresolvedDefectParts(p, round) {
  const sec = p.검수?.[`차${round}`]?.공정비고;
  if (!sec) return [];
  return BUPMOK.filter((b) => (sec[b]?.항목 || []).some((it) => (it.내용 || it.사진) && !it.완료));
}

/* ── 출고사진 (2026-08-22 대표님) ──
   박스를 내보내기 전 다섯 면을 찍어 남긴다. 나중에 현장에서 파손 시비가 생기면
   나갈 때 상태를 확인할 근거가 된다. */
export const SHIP_PHOTO_SIDES = ['전면', '후면', '좌측', '우측', '상부'];

// p.출고사진 = { 'P/W BOX': { 전면: url, ... } }
export function boxShipPhotos(p, box) {
  return (p.출고사진 || {})[box] || {};
}
// 그 박스에 찍어 둔 면의 수
export function shipPhotoCount(p, box) {
  const v = boxShipPhotos(p, box);
  return SHIP_PHOTO_SIDES.filter((k) => v[k]).length;
}

/* ── BOX별 하위(자재입고·불량) → 상태 자동 산출 (2026-07-20) ── */
// 박스입고: p.박스입고 = { 'P/W BOX': {판금,하네스,사급,도급 boolean}, ... }
export function boxMat(p, box) {
  return (p.박스입고 || {})[box] || {};
}
// 판넬 전체 자재입고 요약(모바일 카드용): 각 자재가 실물 BOX(MP 제외) 전부에 입고됐으면 완료
export function jaipRollup(p) {
  const boxes = BUPMOK.filter((b) => b !== 'MP');
  return Object.fromEntries(JAIP.map((k) => [k, boxes.length > 0 && boxes.every((b) => boxMat(p, b)[k])]));
}
// 해당 박스에 미해결 불량이 있나 (검수 1·2차 공정비고 항목 중 내용 있고 미완료)
export function boxHasDefect(insp, box) {
  // 사진만 등록(내용 빈값)한 불량도 인정 — 내용 또는 사진이 있고 미완료면 불량
  return [1, 2].some((r) =>
    (insp?.[`차${r}`]?.공정비고?.[box]?.항목 || []).some((it) => (it.내용 || it.사진) && !it.완료),
  );
}
// BOX별 자재입고 체크 일자: p.박스입고일자 = { box: { 판금:'YYYY-MM-DD', ... } }
export function boxMatDate(p, box) {
  return (p.박스입고일자 || {})[box] || {};
}
// BOX 완료 일자 = 4종 자재입고일 중 가장 늦은 날 (완료는 4종 전부 입고 시점)
export function boxDoneDate(p, box) {
  const d = boxMatDate(p, box);
  const arr = JAIP.map((k) => d[k]).filter(Boolean);
  return arr.length ? [...arr].sort().slice(-1)[0] : '';
}
// BOX 불량 최초 등록 일자 (미해결 항목 중 가장 이른 일자)
export function boxDefectDate(insp, box) {
  let earliest = '';
  [1, 2].forEach((r) => {
    (insp?.[`차${r}`]?.공정비고?.[box]?.항목 || []).forEach((it) => {
      if ((it.내용 || it.사진) && !it.완료 && it.일자 && (!earliest || it.일자 < earliest)) earliest = it.일자;
    });
  });
  return earliest;
}
// 해당 박스의 불량이 모두 처리완료됐나 (과거 불량 있었고, 미해결 없음)
export function boxDefectResolved(insp, box) {
  const items = [1, 2].flatMap((r) => insp?.[`차${r}`]?.공정비고?.[box]?.항목 || []);
  const has = (it) => it.내용 || it.사진;
  const resolved = items.some((it) => has(it) && it.완료);
  const unresolved = items.some((it) => has(it) && !it.완료);
  return resolved && !unresolved;
}

// 불량 점검을 마쳤다고 표시했나 — 「불량 없음」 체크 (검수 1·2차 중 한 곳이라도)
export function boxNoDefectChecked(insp, box) {
  return [1, 2].some((r) => !!insp?.[`차${r}`]?.공정비고?.[box]?.불량없음);
}

// 불량 확인이 끝났나 —
//   ① 「불량 없음」을 체크했거나 ② 불량이 있었지만 모두 처리됐거나.
// 자재만 들어오고 아직 아무도 들여다보지 않은 박스는 여기에 들지 않는다.
export function boxDefectChecked(insp, box) {
  return boxNoDefectChecked(insp, box) || boxDefectResolved(insp, box);
}

// 박스 종합상태 (2026-08-22 대표님: 불량 확인까지 되어야 완료)
//   미해결 불량            → 문제
//   자재 4종 + 불량 확인   → 완료
//   자재 4종 · 불량 미확인 → 진행중  (예전에는 여기서 바로 완료가 됐다)
//   그 외                  → 대기
export function deriveBoxStatus(p, box, inspOverride, matOverride) {
  const insp = inspOverride || p.검수;
  if (boxHasDefect(insp, box)) return '문제';
  const mat = matOverride || boxMat(p, box);
  if (!JAIP.every((k) => mat[k])) return '대기';
  return boxDefectChecked(insp, box) ? '완료' : '진행중';
}

/* ── 로직 ── */
// 프로젝트 그룹(납기 묶음) — 뒤 _N / -N 제거
export const getProjGroup = (p) => String(p || '').replace(/[_-]\d+$/, '');

// MP 하위 상태들 → MP 종합 상태 파생
export function deriveMpState(mp = {}) {
  const v = MP_SUBS.map((k) => normState(mp[k]));
  if (v.some((s) => s === '문제')) return '문제';
  if (v.some((s) => s === '진행중')) return '진행중';
  if (v.every((s) => s === '완료')) return '완료';
  return '대기';
}

// 진행률 + 종합상태 산출 (기존 recompute 이식)
// 저장값 정규화 — 표시라벨 '불량'이 잘못 저장된 경우 '문제'로
export const normState = (s) => (s === '불량' ? '문제' : s || '대기');

// 부품별 완성 분율(0~1): 일반 부품은 완료=1, MP는 하위 9종 완료율로 부분 반영
export function boxFraction(p, box) {
  if (box === 'MP') {
    const done = MP_SUBS.filter((k) => normState((p.mp하위상태 || {})[k]) === '완료').length;
    return MP_SUBS.length ? done / MP_SUBS.length : 0;
  }
  return normState((p.부품상태 || {})[box]) === '완료' ? 1 : 0;
}

export function recompute(raw) {
  const p = normalizeBoxKeys(raw); // 옛 BOX 키(H/T상 …)를 새 이름으로 읽는다
  const mpS = deriveMpState(p.mp하위상태 || {});
  const all = BUPMOK.map((b) => normState((p.부품상태 || {})[b]));
  const done = all.filter((s) => s === '완료').length;
  const hasIssue = all.some((s) => s === '문제');
  const hasProgress = all.some((s) => s === '진행중' || s === '완료') || boxFraction(p, 'MP') > 0;
  // 진행률: MP는 전체의 12.5% 고정(하위 9종으로 분할), 나머지 부품이 87.5%를 균등 분할
  const others = BUPMOK.filter((b) => b !== 'MP');
  const otherW = others.length ? (1 - MP_WEIGHT) / others.length : 0;
  const frac = others.reduce((a, b) => a + boxFraction(p, b) * otherW, 0) + boxFraction(p, 'MP') * MP_WEIGHT;
  const progress = Math.round(frac * 100);
  let os;
  if (p.insp2done) os = '출고숨김';
  else if (p.출고완료) os = '출고완료';
  else if (p.검수완료) os = '검수완료';
  else if (hasIssue) os = '보류';
  else if (done === all.length) os = '검수대기';
  else if (hasProgress) os = '제작중';
  else os = '대기중';
  return { ...p, mpState: mpS, progress, overallStatus: os };
}

// D-day 계산 (오늘 기준 남은 일수). today는 주입(테스트/결정성).
export function getDday(date, today = new Date()) {
  if (!date) return 9999;
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d - t) / 86400000);
}

// 새 판넬 레코드 기본 골격
export function emptyPanel(overrides = {}) {
  return recompute({
    회사: '',
    프로젝트: '',
    호기: '',
    정역: '',
    자재: '',
    CHUCK: '',
    기구제작: '',
    납기: '',
    턴온: '',
    // 턴온 뒤 마무리 일정 — 현장에서 이 순서대로 흐른다 (2026-08-12 대표님)
    ioCheck: '',
    조정: '',
    입고검수: '',
    고객검수: '',
    출하검수: '',
    포장: '',
    출하: '',
    자재입고: '',
    자재입고일: {}, // 일정 항목별 입고일 { 판금:'YYYY-MM-DD', 하네스_사급:'', ... }
    비고: '',
    현장메모: '',
    자재입고상태: Object.fromEntries(JAIP.map((k) => [k, false])),
    부품상태: Object.fromEntries(BUPMOK.map((b) => [b, '대기'])),
    mp하위상태: Object.fromEntries(MP_SUBS.map((k) => [k, '대기'])),
    검수완료: false,
    출고완료: false,
    insp2done: false,
    ...overrides,
  });
}
