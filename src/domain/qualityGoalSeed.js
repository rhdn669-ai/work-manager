// 연간 품질목표 기본안
//
// ※ 출처 표시 주의 —
//   source: '원본' … 대표님이 올려주신 QP-105B 「품질목표 관리」 시트에 실제로 적혀 있던 값
//   source: '임의' … 원본에 없어서 제가 임의로 잡은 값입니다. 실제 사내 목표로 확정된 수치가
//                    아니므로 반드시 검토·수정해서 쓰셔야 합니다.
//
// 대장(기준정보 > 품질목표)이 비어 있을 때 이 목록을 한 번에 넣어 시작점으로 쓴다.
export const QUALITY_GOAL_SEED = [
  {
    source: '원본',
    goalName: '출하검사 불량률',
    goalDirection: '이하',
    goalTarget: 7,
    goalFormula: '총 불량항목수 ÷ 총 검사수',
    goalDept: '품질팀',
    remarks: 'QP-105B 원본 시트에 기재돼 있던 값',
  },
  {
    source: '임의',
    goalName: '수입검사 합격률',
    goalDirection: '이상',
    goalTarget: 95,
    goalFormula: '합격 건수 ÷ 총 검사 건수',
    goalDept: '품질팀',
    remarks: '임의로 잡은 값 — 사내 기준 확인 후 수정 필요',
  },
  {
    source: '임의',
    goalName: '부적합 종결률',
    goalDirection: '이상',
    goalTarget: 90,
    goalFormula: '종결일이 입력된 부적합 ÷ 전체 부적합',
    goalDept: '품질팀',
    remarks: '임의로 잡은 값 — 사내 기준 확인 후 수정 필요',
  },
  {
    source: '임의',
    goalName: '계측기 교정 준수율',
    goalDirection: '이상',
    goalTarget: 100,
    goalFormula: '차기교정일을 넘기지 않은 계측기 ÷ 전체 계측기',
    goalDept: '품질팀',
    remarks: '임의로 잡은 값 — 사내 기준 확인 후 수정 필요',
  },
  {
    source: '임의',
    goalName: '협력사 정기평가 이행률',
    goalDirection: '이상',
    goalTarget: 100,
    goalFormula: '평가 완료 업체 ÷ 연간 평가계획 업체',
    goalDept: '품질팀',
    remarks: '임의로 잡은 값 — 사내 기준 확인 후 수정 필요',
  },
];

// 개요 추이 차트에 그릴 목표선. 등록된 '출하검사 불량률' 목표를 우선 쓰고,
// 아직 등록 전이면 원본 시트 값(7%)을 임시 기준선으로 쓴다.
export const DEFAULT_DEFECT_RATE_TARGET = 7;

export function defectRateTargetOf(records) {
  const hit = records.find((r) => r.formKey === 'master.goal' && String(r.goalName || '').includes('출하검사 불량률'));
  const v = Number(hit?.goalTarget);
  return Number.isFinite(v) && v > 0
    ? { value: v, fromGoal: true }
    : { value: DEFAULT_DEFECT_RATE_TARGET, fromGoal: false };
}
