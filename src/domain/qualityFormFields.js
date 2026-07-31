// 서식별 필드 정의 — 양식 엔진의 입력값.
// 원본: MES-QUALITY-FORM-SPEC.md (433필드 전수 명세). 여기엔 대장 1행을 이루는
// 헤더 레벨 필드만 담는다. 라인아이템(성적서 X1~X10 측정치, 평가시트 항목별 배점)은
// 중첩 편집기가 필요해 아직 담지 않았다 — 지어내지 않고 비워 둔다.
//
// type: text | num | date | select | textarea
// col: true 면 목록 표의 컬럼으로도 보여준다 (표가 넓어지지 않게 6개 이내로).

const 판정 = ['합격', '부적합', '보류'];

export const FORM_FIELDS = {
  // ── 수입검사 ───────────────────────────────────────────────
  'iqc.report': {
    title: '수입검사 성적서',
    numberPrefix: 'IQC',
    fields: [
      { key: 'projectNo', label: '프로젝트 번호', type: 'text', required: true, col: true },
      { key: 'itemName', label: '품명', type: 'text', required: true, col: true },
      { key: 'itemNo', label: '품번', type: 'text' },
      { key: 'inspector', label: '검사자', type: 'text', required: true, col: true },
      { key: 'receivedDate', label: '입고일', type: 'date', required: true, col: true },
      { key: 'receivedQty', label: '입고 수량', type: 'num' },
      { key: 'inspectionFormType', label: '검사양식', type: 'select', options: ['Harness', '판금'] },
      { key: 'passFailResult', label: '합불 판정', type: 'select', options: 판정, required: true, col: true },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
    lines: {
      title: '검사 항목',
      addLabel: '항목 추가',
      columns: [
        { key: 'inspectionItem', label: '검사항목', type: 'text', w: '20%' },
        { key: 'specification', label: '규격', type: 'text', w: '24%' },
        { key: 'inspectionMethod', label: '검사방법', type: 'text', w: '16%' },
        { key: 'measured', label: '측정치', type: 'text', w: '14%' },
        { key: 'result', label: '판정', type: 'select', options: 판정, w: '14%' },
      ],
    },
  },
  'iqc.ledger': {
    title: '수입검사 관리대장',
    numberPrefix: 'IQC',
    fields: [
      { key: 'inspectionDate', label: '검사일', type: 'date', required: true, col: true },
      { key: 'receivedDate', label: '입고일', type: 'date' },
      { key: 'supplierName', label: '공급업체', type: 'text', required: true, col: true },
      { key: 'itemName', label: '품명', type: 'text', required: true, col: true },
      { key: 'partNo', label: 'Part No.·도면 No.', type: 'text' },
      { key: 'lotNo', label: 'LOT', type: 'text' },
      { key: 'receivedQty', label: '입고수량', type: 'num' },
      { key: 'inspectionType', label: '검사구분', type: 'select', options: ['전수', '샘플링', '무검사'] },
      { key: 'passedQty', label: '합격수량', type: 'num' },
      { key: 'failedQty', label: '부적합수량', type: 'num' },
      { key: 'overallResult', label: '종합판정', type: 'select', options: 판정, required: true, col: true },
      { key: 'inspector', label: '검사자', type: 'text', col: true },
      { key: 'ncrNo', label: '부적합보고서 No.', type: 'text' },
      { key: 'handlingStatus', label: '처리상태', type: 'select', options: ['미조치', '조치중', '종결'] },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
  },

  // ── 출하·부적합 ────────────────────────────────────────────
  'oqc.shipment': {
    title: '출하검사 실적',
    numberPrefix: 'OQC',
    fields: [
      { key: 'inspectionDate', label: '검사일', type: 'date', required: true, col: true },
      { key: 'inspector', label: '검사자', type: 'text', required: true },
      { key: 'equipmentName', label: '설비명', type: 'text' },
      { key: 'itemName', label: '품명', type: 'text', required: true, col: true },
      { key: 'projectNo', label: '프로젝트번호', type: 'text', col: true },
      { key: 'customerName', label: '고객사', type: 'text', col: true },
      { key: 'receivedQty', label: '입고수', type: 'num' },
      { key: 'inspectedQty', label: '검사수', type: 'num' },
      { key: 'defectQty', label: '불량수', type: 'num', col: true },
      { key: 'defectRate', label: '불량지수', type: 'num', calc: 'defectRate', col: true },
      { key: 'actionContent', label: '조치내용', type: 'textarea' },
      // 불량 유형별 건수 — 원본 F03 의 유형 컬럼 그대로
      { key: 'defectCable', label: '케이블', type: 'num', group: '불량 유형' },
      { key: 'defectWiring', label: '배선정리', type: 'num', group: '불량 유형' },
      { key: 'defectAssembly', label: '조립불량', type: 'num', group: '불량 유형' },
      { key: 'defectCleaning', label: '크리닝', type: 'num', group: '불량 유형' },
      { key: 'defectStickerHole', label: '스티커·잔공누락', type: 'num', group: '불량 유형' },
      { key: 'defectLabeling', label: '식별표시', type: 'num', group: '불량 유형' },
      { key: 'defectCableTie', label: '케이블타이·후크밴드', type: 'num', group: '불량 유형' },
      { key: 'defectDuct', label: 'DUCT 미준수', type: 'num', group: '불량 유형' },
      { key: 'defectTorque', label: 'Torque 체결미흡', type: 'num', group: '불량 유형' },
      { key: 'defectEtc', label: '기타', type: 'num', group: '불량 유형' },
    ],
  },
  'oqc.ncr': {
    title: '부적합 실적',
    numberPrefix: 'NCR',
    fields: [
      { key: 'inspectionDate', label: '검사일', type: 'date', required: true, col: true },
      { key: 'inspector', label: '검사자', type: 'text', required: true },
      { key: 'equipmentName', label: '설비명', type: 'text' },
      { key: 'itemName', label: '품명', type: 'text', required: true, col: true },
      { key: 'projectNo', label: '프로젝트번호', type: 'text' },
      { key: 'customerName', label: '고객사', type: 'text', col: true },
      {
        key: 'processType',
        label: '발생공정',
        type: 'select',
        options: ['수입검사', '공정검사', '출하검사'],
        required: true,
        col: true,
      },
      { key: 'receivedQty', label: '입고수', type: 'num' },
      { key: 'inspectedQty', label: '검사수', type: 'num' },
      { key: 'defectQty', label: '불량수', type: 'num' },
      { key: 'defectRate', label: '불량지수', type: 'num', calc: 'defectRate' },
      { key: 'actionContent', label: '조치내용', type: 'textarea' },
      { key: 'countermeasureContent', label: '대책 내용', type: 'textarea' },
      { key: 'verify1Date', label: '1차 검증일', type: 'date', group: '검증 이력' },
      { key: 'verify1Content', label: '1차 검증내용', type: 'text', group: '검증 이력' },
      { key: 'verify1By', label: '1차 검증자', type: 'text', group: '검증 이력' },
      { key: 'verify2Date', label: '2차 검증일', type: 'date', group: '검증 이력' },
      { key: 'verify2Content', label: '2차 검증내용', type: 'text', group: '검증 이력' },
      { key: 'verify2By', label: '2차 검증자', type: 'text', group: '검증 이력' },
      { key: 'verify3Date', label: '3차 검증일', type: 'date', group: '검증 이력' },
      { key: 'verify3Content', label: '3차 검증내용', type: 'text', group: '검증 이력' },
      { key: 'verify3By', label: '3차 검증자', type: 'text', group: '검증 이력' },
      { key: 'finalResult', label: '최종판정', type: 'select', options: 판정, col: true },
      { key: 'closedDate', label: '종결일', type: 'date', col: true },
    ],
  },
  'oqc.material': {
    title: '불량자재 이력',
    numberPrefix: 'DMT',
    fields: [
      { key: 'occurredDate', label: '발생일자', type: 'date', required: true, col: true },
      { key: 'projectNo', label: '프로젝트', type: 'text', col: true },
      { key: 'serialNo', label: 'S/N', type: 'text' },
      { key: 'itemName', label: '품명', type: 'text', required: true, col: true },
      { key: 'itemNo', label: '품번', type: 'text' },
      { key: 'defectSymptom', label: '불량 현상', type: 'textarea', required: true, col: true },
      { key: 'checkedBy', label: '확인자', type: 'text' },
      { key: 'writtenBy', label: '작성자', type: 'text' },
      { key: 'defectReceivedDate', label: '불량 접수일자', type: 'date' },
      { key: 'customerConfirm', label: '고객확인', type: 'select', options: ['확인', '미확인', '해당없음'] },
      { key: 'improvedItemReceivedDate', label: '개선품 입고일자', type: 'date', col: true },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
  },

  // ── 변경관리 ───────────────────────────────────────────────
  'change.request': {
    title: '5M1E 변경 신청서',
    numberPrefix: 'CHG',
    fields: [
      { key: 'applicantName', label: '성명', type: 'text', required: true, col: true },
      { key: 'dept', label: '부서', type: 'text', required: true },
      { key: 'position', label: '직급', type: 'text' },
      { key: 'applyDate', label: '신청일자', type: 'date', required: true, col: true },
      { key: 'equipmentName', label: '설비명', type: 'text' },
      { key: 'projectName', label: '프로젝트명', type: 'text', col: true },
      { key: 'customerName', label: '고객사', type: 'text' },
      { key: 'itemTarget', label: '품명·대상', type: 'text', required: true, col: true },
      { key: 'targetUnitLot', label: '대상호기·LOT', type: 'text' },
      { key: 'plannedApplyDate', label: '적용예정일', type: 'date' },
      { key: 'applyType', label: '신청구분', type: 'select', options: ['신규', '변경', '취소'] },
      {
        key: 'changeCategory',
        label: '5M1E 구분',
        type: 'select',
        options: [
          'Man(사람)',
          'Machine(설비)',
          'Material(자재)',
          'Method(방법)',
          'Measurement(측정)',
          'Environment(환경)',
        ],
        required: true,
        col: true,
      },
      { key: 'changeGrade', label: '변경등급', type: 'select', options: ['경미', '보통', '중대'] },
      { key: 'customerApprovalNeeded', label: '고객승인', type: 'select', options: ['필요', '불필요'] },
      { key: 'changeReasonDetail', label: '변경 사유', type: 'textarea' },
      { key: 'beforeContent', label: '변경 전 내용', type: 'textarea', required: true },
      { key: 'afterContent', label: '변경 후 내용', type: 'textarea', required: true },
      { key: 'reviewContent', label: '검토내용', type: 'textarea', group: '사전검토' },
      { key: 'riskLevel', label: '위험도', type: 'select', options: ['상', '중', '하'], group: '사전검토' },
      {
        key: 'reviewResult',
        label: '검토결과',
        type: 'select',
        options: ['승인', '조건부승인', '반려'],
        group: '사전검토',
      },
      { key: 'verifyMethod', label: '검증방법', type: 'text', group: '검증·적용' },
      { key: 'verifyResult', label: '검증결과', type: 'select', options: ['적합', '부적합'], group: '검증·적용' },
      { key: 'verifyDate', label: '검증일자', type: 'date', group: '검증·적용' },
      { key: 'appliedDate', label: '적용일자', type: 'date', group: '검증·적용' },
      { key: 'approvalCondition', label: '승인조건·의견', type: 'textarea', group: '검증·적용' },
    ],
  },
  'change.risk': {
    title: '5M1E 리스크 관리대장',
    numberPrefix: 'RSK',
    fields: [
      { key: 'changeDate', label: '변경일자', type: 'date', required: true, col: true },
      { key: 'projectEquipment', label: '프로젝트·설비', type: 'text', col: true },
      { key: 'customerName', label: '고객사', type: 'text' },
      {
        key: 'changeCategory',
        label: '5M1E 구분',
        type: 'select',
        options: [
          'Man(사람)',
          'Machine(설비)',
          'Material(자재)',
          'Method(방법)',
          'Measurement(측정)',
          'Environment(환경)',
        ],
        required: true,
        col: true,
      },
      { key: 'changeItem', label: '변경항목', type: 'text', required: true, col: true },
      { key: 'beforeContent', label: '변경 전', type: 'textarea' },
      { key: 'afterContent', label: '변경 후', type: 'textarea' },
      { key: 'changeReason', label: '변경사유', type: 'textarea' },
      { key: 'expectedImpact', label: '예상 영향', type: 'textarea' },
      {
        key: 'impactScore',
        label: '영향도(1~5)',
        type: 'select',
        options: ['1', '2', '3', '4', '5'],
        required: true,
        group: '리스크 평가',
      },
      {
        key: 'probabilityScore',
        label: '발생가능성(1~5)',
        type: 'select',
        options: ['1', '2', '3', '4', '5'],
        required: true,
        group: '리스크 평가',
      },
      { key: 'riskScore', label: '점수', type: 'num', calc: 'riskScore', col: true, group: '리스크 평가' },
      { key: 'riskGrade', label: '등급', type: 'text', calc: 'riskGrade', col: true, group: '리스크 평가' },
      { key: 'actionContent', label: '조치내용', type: 'textarea', group: '조치' },
      { key: 'actionDept', label: '담당부서', type: 'text', group: '조치' },
      { key: 'actionOwner', label: '담당자', type: 'text', group: '조치' },
      { key: 'actionDueDate', label: '완료예정일', type: 'date', group: '조치' },
      { key: 'actionDoneDate', label: '완료일', type: 'date', group: '조치' },
      {
        key: 'postImpactScore',
        label: '조치 후 영향도',
        type: 'select',
        options: ['1', '2', '3', '4', '5'],
        group: '조치 후',
      },
      {
        key: 'postProbabilityScore',
        label: '조치 후 발생가능성',
        type: 'select',
        options: ['1', '2', '3', '4', '5'],
        group: '조치 후',
      },
      { key: 'residualScore', label: '잔여점수', type: 'num', calc: 'residualScore', group: '조치 후' },
      { key: 'residualGrade', label: '잔여등급', type: 'text', calc: 'residualGrade', group: '조치 후' },
      { key: 'effectConfirm', label: '효과확인', type: 'select', options: ['확인', '미확인'], group: '조치 후' },
      { key: 'finalApproval', label: '승인', type: 'select', options: ['승인', '보류', '반려'] },
    ],
  },

  // ── 교육·자격 ──────────────────────────────────────────────
  'training.log': {
    title: '교육일지',
    numberPrefix: 'EDU',
    fields: [
      { key: 'trainingDate', label: '교육일자', type: 'date', required: true, col: true },
      { key: 'trainingHours', label: '시간', type: 'text' },
      { key: 'trainer', label: '담당', type: 'text', required: true, col: true },
      { key: 'location', label: '장소', type: 'text' },
      { key: 'trainingTarget', label: '교육대상', type: 'text', col: true },
      { key: 'attendeeCount', label: '참석인원', type: 'num', col: true },
      { key: 'trainingName', label: '교육명', type: 'text', required: true, col: true },
      { key: 'trainingContent', label: '교육내용', type: 'textarea', required: true },
      { key: 'trainingResult', label: '교육결과', type: 'textarea' },
      { key: 'notes', label: '특이사항', type: 'textarea' },
    ],
  },
  'training.grade': {
    title: '자격등급 재평가 신청서',
    numberPrefix: 'QLF',
    fields: [
      { key: 'applicantName', label: '성명', type: 'text', required: true, col: true },
      { key: 'dept', label: '부서', type: 'text', required: true, col: true },
      { key: 'position', label: '직급', type: 'text' },
      { key: 'jobRole', label: '직무', type: 'text' },
      { key: 'applyDate', label: '신청일자', type: 'date', required: true, col: true },
      {
        key: 'currentLevel',
        label: '현재등급',
        type: 'select',
        options: ['LEVEL 1', 'LEVEL 2', 'LEVEL 3', 'LEVEL 4'],
        required: true,
        col: true,
      },
      { key: 'adjustStatus', label: '조정상태', type: 'select', options: ['정지', '하향', '갱신'] },
      { key: 'suspendedDate', label: '정지·하향 일자', type: 'date' },
      {
        key: 'restoreLevel',
        label: '복원신청등급',
        type: 'select',
        options: ['LEVEL 1', 'LEVEL 2', 'LEVEL 3', 'LEVEL 4'],
      },
      { key: 'applyType', label: '신청구분', type: 'select', options: ['정기', '수시', '복원'] },
      { key: 'applyReason', label: '신청사유', type: 'textarea', required: true },
      { key: 'causeDetail', label: '발생원인', type: 'textarea' },
      { key: 'retrainingName', label: '재교육명', type: 'text', group: '재교육·개선' },
      { key: 'retrainingDate', label: '교육일자', type: 'date', group: '재교육·개선' },
      { key: 'trainer', label: '교육자', type: 'text', group: '재교육·개선' },
      { key: 'retrainingContent', label: '교육내용', type: 'textarea', group: '재교육·개선' },
      { key: 'improvementAction', label: '개선조치', type: 'textarea', group: '재교육·개선' },
      { key: 'evalDate', label: '평가일자', type: 'date', group: '재평가 결과' },
      { key: 'evaluator', label: '평가자', type: 'text', group: '재평가 결과' },
      { key: 'theoryScore', label: '이론점수', type: 'num', group: '재평가 결과' },
      { key: 'practicalScore', label: '실기점수', type: 'num', group: '재평가 결과' },
      { key: 'finalJudgement', label: '최종판정', type: 'select', options: 판정, col: true, group: '재평가 결과' },
      {
        key: 'grantedLevel',
        label: '부여·복원등급',
        type: 'select',
        options: ['LEVEL 1', 'LEVEL 2', 'LEVEL 3', 'LEVEL 4'],
        group: '재평가 결과',
      },
      { key: 'approvedDate', label: '승인일', type: 'date', group: '재평가 결과' },
      { key: 'evalOpinion', label: '평가의견', type: 'textarea', group: '재평가 결과' },
    ],
  },

  // ── 협력사평가 ─────────────────────────────────────────────
  'vendor.eval': {
    title: '협력사 평가시트',
    numberPrefix: 'VND',
    fields: [
      { key: 'supplierName', label: '공급자명', type: 'text', required: true, col: true },
      {
        key: 'evalType',
        label: '평가구분',
        type: 'select',
        options: ['신규평가', '사후평가'],
        required: true,
        col: true,
      },
      { key: 'evalDate', label: '평가일', type: 'date', required: true, col: true },
      { key: 'registeredField', label: '등록분야', type: 'text' },
      { key: 'address', label: '소재지', type: 'text' },
      { key: 'tel', label: '연락처', type: 'text' },
      { key: 'evaluator', label: '평가자', type: 'text', col: true },
      { key: 'totalScore', label: '총점', type: 'num', calc: 'evalTotal', col: true },
      { key: 'grade', label: '등급', type: 'text', calc: 'evalGrade', col: true },
      { key: 'overallResult', label: '전체판정', type: 'text', calc: 'evalOverall' },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
    lines: {
      title: '평가 항목',
      addLabel: '항목 추가',
      // 계(A×B) 는 행마다 자동계산 — 원본 F07 수식 그대로
      columns: [
        { key: 'evalCategory', label: '평가항목', type: 'text', w: '22%' },
        { key: 'evalDetail', label: '평가내용', type: 'text', w: '30%' },
        { key: 'weight', label: '중요도(A)', type: 'num', w: '12%' },
        { key: 'score', label: '점수(B)', type: 'num', w: '12%' },
        { key: 'weightedScore', label: '계(A×B)', type: 'num', w: '12%', calc: true },
      ],
      rowCalc: (r) => ({ ...r, weightedScore: (Number(r.weight) || 0) * (Number(r.score) || 0) }),
    },
  },
  // ── 기준정보 (품질목표 · 인원명부) ─────────────────────────
  'master.goal': {
    title: '품질목표 관리',
    numberPrefix: 'GOL',
    fields: [
      { key: 'managementYear', label: '관리연도', type: 'num', required: true, col: true },
      { key: 'goalName', label: '품질목표', type: 'text', required: true, col: true },
      { key: 'goalDirection', label: '방향', type: 'select', options: ['이하', '이상'], required: true },
      { key: 'goalTarget', label: '목표값', type: 'num', required: true, col: true },
      { key: 'goalFormula', label: '산정기준', type: 'text' },
      { key: 'goalActualYear', label: '연간실적', type: 'num', col: true },
      { key: 'goalAchieveRate', label: '달성률(%)', type: 'num', calc: 'achieveRate', col: true },
      { key: 'goalStatus', label: '진행상태', type: 'text', calc: 'goalStatus', col: true },
      { key: 'goalDept', label: '담당부서', type: 'text' },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
  },
  'master.roster': {
    title: '인원 명부·인증기준',
    numberPrefix: 'PSN',
    fields: [
      { key: 'name', label: '성명', type: 'text', required: true, col: true },
      { key: 'dept', label: '부서', type: 'text', required: true, col: true },
      { key: 'position', label: '직급', type: 'text' },
      { key: 'career', label: '경력', type: 'text' },
      { key: 'hireDate', label: '입사일', type: 'date' },
      { key: 'level1GrantedDate', label: 'LEVEL 1 부여일', type: 'date', group: '자격 부여 이력' },
      { key: 'level2GrantedDate', label: 'LEVEL 2 부여일', type: 'date', group: '자격 부여 이력' },
      { key: 'level3GrantedDate', label: 'LEVEL 3 부여일', type: 'date', group: '자격 부여 이력' },
      { key: 'level4GrantedDate', label: 'LEVEL 4 부여일', type: 'date', group: '자격 부여 이력' },
      { key: 'currentLevel', label: '현재 LEVEL', type: 'text', calc: 'currentLevel', col: true },
      { key: 'lastGrantedDate', label: '최종 부여일', type: 'date', calc: 'lastGranted', col: true },
      { key: 'currentLevelElapsed', label: '현 LEVEL 경과', type: 'text', calc: 'levelElapsed', col: true },
    ],
  },
};

// 자동계산 — 원본 엑셀 수식을 그대로 옮긴 것
const RISK_GRADE = (score) =>
  score >= 20 ? 'A(즉시조치)' : score >= 12 ? 'B(계획조치)' : score >= 6 ? 'C(관찰)' : 'D(수용)';

// 협력사 평가 등급 — 총점 기준
const EVAL_GRADE = (t) => (t >= 90 ? 'A' : t >= 80 ? 'B' : t >= 70 ? 'C' : 'D');

export function computeCalcFields(formKey, v) {
  const def = FORM_FIELDS[formKey];
  if (!def) return v;
  const out = { ...v };
  const lines = Array.isArray(out.lines) ? out.lines : [];
  for (const f of def.fields) {
    if (!f.calc) continue;
    const n = (k) => Number(out[k]) || 0;
    if (f.calc === 'defectRate') {
      const insp = n('inspectedQty');
      out.defectRate = insp ? Number((n('defectQty') / insp).toFixed(4)) : 0;
    } else if (f.calc === 'riskScore') {
      out.riskScore = n('impactScore') * n('probabilityScore');
    } else if (f.calc === 'riskGrade') {
      out.riskGrade = out.riskScore ? RISK_GRADE(out.riskScore) : '';
    } else if (f.calc === 'residualScore') {
      out.residualScore = n('postImpactScore') * n('postProbabilityScore');
    } else if (f.calc === 'residualGrade') {
      out.residualGrade = out.residualScore ? RISK_GRADE(out.residualScore) : '';
    } else if (f.calc === 'evalTotal') {
      out.totalScore = lines.reduce((s2, r) => s2 + (Number(r.weightedScore) || 0), 0);
    } else if (f.calc === 'evalGrade') {
      out.grade = lines.length ? EVAL_GRADE(out.totalScore) : '';
    } else if (f.calc === 'achieveRate') {
      const t = n('goalTarget');
      out.goalAchieveRate = t ? Math.round((n('goalActualYear') / t) * 1000) / 10 : 0;
    } else if (f.calc === 'goalStatus') {
      const t = n('goalTarget');
      const a = n('goalActualYear');
      out.goalStatus = !t || !a ? '' : (out.goalDirection === '이하' ? a <= t : a >= t) ? '달성' : '미달';
    } else if (f.calc === 'currentLevel') {
      const lv = [4, 3, 2, 1].find((L) => out[`level${L}GrantedDate`]);
      out.currentLevel = lv ? `LEVEL ${lv}` : '';
    } else if (f.calc === 'lastGranted') {
      const ds = [1, 2, 3, 4]
        .map((L) => out[`level${L}GrantedDate`])
        .filter(Boolean)
        .sort();
      out.lastGrantedDate = ds.length ? ds[ds.length - 1] : '';
    } else if (f.calc === 'levelElapsed') {
      out.currentLevelElapsed = out.lastGrantedDate
        ? `${Math.floor((Date.now() - new Date(out.lastGrantedDate)) / 86400000)}일`
        : '';
    } else if (f.calc === 'evalOverall') {
      out.overallResult = !lines.length
        ? ''
        : out.totalScore >= 80
          ? '승인'
          : out.totalScore >= 70
            ? '조건부승인'
            : '부적격';
    }
  }
  return out;
}
