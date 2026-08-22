// 불량 유형 — 원본 서식 F03(출하검사 실적)의 유형 컬럼을 옮긴 뒤 현장에서 쓰는 항목을 더한다.
// 생산현장(불량 등록)과 품질보증(부적합·출하검사 실적 집계)이 같은 목록을 써야
// 현장에서 체크한 유형이 그대로 대장에 집계된다. 여기가 유일한 출처.
export const DEFECT_TYPES = [
  { key: 'defectCable', label: '케이블' },
  { key: 'defectWiring', label: '배선정리' },
  { key: 'defectMiswiring', label: '오배선' }, // 2026-08-22 대표님
  { key: 'defectAssembly', label: '조립불량' },
  { key: 'defectCleaning', label: '크리닝' },
  { key: 'defectStickerHole', label: '잔공 누락' },
  { key: 'defectEyeMarking', label: '아이마킹' }, // 2026-08-22 대표님
  { key: 'defectLabelMissing', label: '라벨 누락' }, // 2026-08-22 대표님
  { key: 'defectLabeling', label: '식별표시' },
  { key: 'defectCableTie', label: '케이블타이·후크밴드' },
  { key: 'defectDuct', label: 'DUCT 미준수' },
  { key: 'defectTorque', label: 'Torque 체결미흡' },
  { key: 'defectEtc', label: '기타' },
];

export const DEFECT_TYPE_LABELS = DEFECT_TYPES.map((t) => t.label);

// 서식 필드 정의(FORM_FIELDS)에 그대로 펼쳐 넣기 위한 헬퍼
export const defectTypeFields = () =>
  DEFECT_TYPES.map((t) => ({ key: t.key, label: t.label, type: 'num', group: '불량 유형' }));

// 라벨 → 키. 현장에서 고른 유형 문자열을 집계 키로 되돌린다.
const KEY_OF = Object.fromEntries(DEFECT_TYPES.map((t) => [t.label, t.key]));

// 불량 목록 → { defectCable: 2, defectEtc: 1, ... } (0건인 유형은 넣지 않는다)
export function countByType(defects) {
  const out = {};
  defects.forEach((d) => {
    const k = KEY_OF[d.유형];
    if (k) out[k] = (out[k] || 0) + 1;
  });
  return out;
}
