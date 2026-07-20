// 판넬 생산현황 도메인 모델 — 기존 index.html의 검증된 로직을 이식.
// 화면/DB와 독립. 상태 파생·상수는 전부 여기 한곳에서 관리.

/* ── 부품/공정 상수 ── */
// 부품(BOX·판넬) 6종 — 명판(P/W BOX·S/D·H/T·ROBOT 등)과 동일 도메인
export const BUPMOK = ['P/W BOX', 'LODER', 'S/D', 'H/T상', 'H/T하', 'ROBOT', 'MP'];
// 자재 입고 항목 4종 (boolean)
export const JAIP = ['판금', '하네스', '사급', '도급'];
// MP 판넬 하위 10종
export const MP_SUBS = ['PLC', 'I/O', '드라이브', 'INV', 'CN', 'BORAD', 'EMS', 'SWITCH', 'V메타']; // MAIN → 부품 'MP'로 승격 (2026-07-20)
// 진행률에서 MP가 차지하는 고정 비중(12.5%). 하위 9종으로 다시 분할, 나머지 부품은 87.5% 균등.
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
  return BUPMOK.filter((b) => (sec[b]?.항목 || []).some((it) => it.내용 && !it.완료));
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
  return [1, 2].some((r) => (insp?.[`차${r}`]?.공정비고?.[box]?.항목 || []).some((it) => it.내용 && !it.완료));
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
      if (it.내용 && !it.완료 && it.일자 && (!earliest || it.일자 < earliest)) earliest = it.일자;
    });
  });
  return earliest;
}
// 박스 종합상태: 미해결 불량→문제 / 입고4개 완료→완료 / 그 외 대기
export function deriveBoxStatus(p, box, inspOverride, matOverride) {
  const insp = inspOverride || p.검수;
  if (boxHasDefect(insp, box)) return '문제';
  const mat = matOverride || boxMat(p, box);
  if (JAIP.every((k) => mat[k])) return '완료';
  return '대기';
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

export function recompute(p) {
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
    기구제작: '',
    납기: '',
    턴온: '',
    자재입고: '',
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
