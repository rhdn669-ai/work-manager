// 품질 서식 정의 — 서식 15종을 업무 흐름 6묶음으로 구성
// 명세 원본: MES-QUALITY-FORM-SPEC.md (433필드, 누락 0 검증본)
// 정의를 코드 상수로 두는 이유: 서식 개정 이력이 git 커밋으로 남는다.

export const QUALITY_TABS = [
  {
    key: 'overview',
    label: '개요',
    forms: [],
  },
  {
    key: 'assets',
    label: '자산관리',
    subTabs: [
      { key: 'gauge', label: '계측기', docNo: 'QP-703A' },
      { key: 'jig', label: '지그', docNo: 'QP-706A' },
      { key: 'tool', label: '치공구', docNo: 'QP-705A' },
      // 원본 QP-705A 는 「치공구,TOOL 관리대장」으로 둘을 한 서식에 담았지만
      // 현장에서는 치공구함·툴함을 따로 두므로 대장도 분리한다.
      { key: 'handtool', label: '툴', docNo: 'QP-705A' },
    ],
  },
  {
    key: 'iqc',
    label: '수입검사',
    subTabs: [
      { key: 'report', label: '성적서', docNo: 'QP-104A' },
      { key: 'ledger', label: '관리대장', docNo: 'QP-104B' },
    ],
  },
  {
    key: 'oqc',
    label: '출하·부적합',
    subTabs: [
      { key: 'shipment', label: '출하검사 실적', docNo: 'QP-105B' },
      { key: 'ncr', label: '부적합 실적', docNo: 'QP-809B' },
      { key: 'material', label: '불량자재 이력', docNo: 'QP-704C' },
    ],
  },
  {
    key: 'change',
    label: '변경관리',
    subTabs: [
      { key: 'request', label: '변경 신청서', docNo: 'IP-404B' },
      { key: 'risk', label: '리스크 관리대장', docNo: 'QP-404A' },
    ],
  },
  {
    key: 'training',
    label: '교육·자격',
    subTabs: [
      { key: 'log', label: '교육일지', docNo: 'IP-603D' },
      { key: 'grade', label: '자격등급 재평가', docNo: 'IP-603E' },
    ],
  },
  {
    key: 'vendor',
    label: '협력사평가',
    subTabs: [
      // 원본 107A(등록대장) · 107B(평가계획) · 107C/D(평가시트) 문서번호 그대로
      { key: 'registry', label: '등록대장', docNo: 'QP-107A' },
      { key: 'plan', label: '평가계획', docNo: 'QP-107B' },
      { key: 'eval', label: '평가시트', docNo: 'QP-107C' },
    ],
  },
  {
    key: 'master',
    label: '기준정보',
    subTabs: [
      { key: 'goal', label: '품질목표', docNo: 'QP-105B' },
      { key: 'roster', label: '인원 명부', docNo: '' },
    ],
  },
];

// 개별 낱장(sheet) ↔ 화면 통합 대장(ledger) — 원본 서식의 성격 그대로.
//
//   sheet  : 한 건이 곧 한 장의 문서. 병합 많은 A4 서식으로 열어 채우고 낱장으로 출력한다.
//            문서번호가 건마다 붙는다(QP-104A-0001 …).
//   ledger : 표 자체가 문서 한 장이다. 행이 계속 쌓이므로 문서번호는 대장에 하나뿐 —
//            행에는 NO 일련번호만 남는다. 목록에서 모든 칸을 바로 고친다.
//
// 여태 이 분류를 서식의 paper·lines 속성 유무로 간접 판정했다. 그러면 어떤 서식에
// 라인아이템을 하나 붙이는 순간 분류가 조용히 바뀐다 — 그래서 여기 한 곳에 명시한다.
// 자산 4종(계측기·지그·치공구·툴)은 assets.* 로 별도 컬렉션이라 'asset'.
export const FORM_KIND = {
  'iqc.report': 'sheet', // 수입검사 성적서
  'iqc.ledger': 'ledger', // 수입검사 관리대장
  'oqc.shipment': 'ledger', // 출하검사 실적
  'oqc.ncr': 'ledger', // 부적합 실적
  'oqc.material': 'ledger', // 불량자재 이력
  'change.request': 'sheet', // 5M1E 변경 신청서
  'change.risk': 'ledger', // 5M1E 리스크 관리대장
  'training.log': 'sheet', // 교육일지
  'training.grade': 'sheet', // 자격등급 재평가 신청서
  'vendor.registry': 'ledger', // 협력사 등록대장
  'vendor.plan': 'ledger', // 협력사 평가계획
  'vendor.eval': 'sheet', // 협력사 평가시트
  'master.goal': 'ledger', // 품질목표 관리
  'master.roster': 'ledger', // 인원 명부·인증기준
};

export const kindOf = (formKey) =>
  String(formKey).startsWith('assets.') ? 'asset' : FORM_KIND[formKey] || 'ledger';

// 판정값 — 전 서식 공통 3값 (합불·적합/부적합·OK/NG 혼재를 여기로 통일)
export const VERDICT = {
  pass: { label: '합격', cls: 'badge-safe' },
  fail: { label: '부적합', cls: 'badge-danger' },
  hold: { label: '보류', cls: 'badge-hold' },
};

// 자산 상태 — 차기교정일 기준 자동 판정
export const ASSET_STATUS = {
  normal: { label: '정상', cls: 'badge-safe' },
  due: { label: '임박', cls: 'badge-caution' },
  over: { label: '초과', cls: 'badge-danger' },
};

// 차기교정일 = 최근교정일 + 교정주기(월)
export function nextCalibrationDate(lastDate, cycleMonths) {
  if (!lastDate || !cycleMonths) return '';
  const d = new Date(lastDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + Number(cycleMonths));
  return d.toISOString().slice(0, 10);
}

// 잔여일 기준 상태 판정 (임박 30일)
export function assetStatusOf(nextDate, today = new Date()) {
  if (!nextDate) return { key: 'normal', days: null };
  const next = new Date(nextDate);
  const days = Math.ceil((next - today) / 86400000);
  if (days < 0) return { key: 'over', days };
  if (days <= 30) return { key: 'due', days };
  return { key: 'normal', days };
}
