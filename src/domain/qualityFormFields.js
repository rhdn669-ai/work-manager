// 서식별 필드 정의 — 양식 엔진의 입력값.
// 원본: MES-QUALITY-FORM-SPEC.md (433필드 전수 명세). 여기엔 대장 1행을 이루는
// 헤더 레벨 필드만 담는다. 라인아이템(성적서 X1~X10 측정치, 평가시트 항목별 배점)은
// 중첩 편집기가 필요해 아직 담지 않았다 — 지어내지 않고 비워 둔다.
//
// type: text | num | date | select | textarea
// col: true 면 목록 표의 컬럼으로도 보여준다 (표가 넓어지지 않게 6개 이내로).

import { defectTypeFields } from './defectTypes';

import { nextCalibrationDate } from './qualityForms';
import { FACTOR_CATEGORIES, suggestImpact } from './changeFactors';

const 판정 = ['합격', '부적합', '보류'];
const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

export const FORM_FIELDS = {
  // ── 자산관리 (계측기 QP-703A · 지그 QP-706A · 치공구/툴 QP-705A) ──────
  // 컬럼 순서까지 원본 엑셀 그대로 맞췄다. 쓰던 감각이 달라지면 안 되기 때문이다.
  //  · 계측기: 교정(성적서·교정기관까지)  · 지그: 등록만(원본에 주기 칸 없음)
  //  · 치공구·툴: 점검(신뢰성 점검) — '교정'이 아니라 '점검'이 원본 용어
  // '상태'는 차기일로 앱이 자동 판정하므로 컬럼에 두지 않는다.
  ...(() => {
    const 구분 = ['계측기', '게이지', '측정공구', '검사장비', '소모성', '기타'];
    const 대상 = ['대상', '비대상'];
    const category = { key: 'category', label: '구분', type: 'select', options: 구분, col: true };
    const name = { key: 'name', label: '명칭', type: 'text', required: true, col: true };
    const maker = { key: 'maker', label: '제조사', type: 'text', col: true };
    const model = { key: 'model', label: '모델·규격', type: 'text' };
    const target = (label) => ({ key: 'target', label, type: 'select', options: 대상 });
    const registerDate = { key: 'registerDate', label: '등록일', type: 'date' };
    const place = [
      { key: 'location', label: '보관위치', type: 'text' },
      { key: 'dept', label: '사용부서', type: 'text' },
      { key: 'owner', label: '관리담당자', type: 'text' },
    ];
    // 주기 관리 — 최근일 + 주기(개월) → 차기일 자동계산
    const cycle = (cycleLabel, lastLabel, nextLabel) => [
      { key: 'cycleMonths', label: cycleLabel, type: 'num' },
      { key: 'lastDate', label: lastLabel, type: 'date', col: true },
      { key: 'nextDate', label: nextLabel, type: 'date', calc: 'nextDate', col: true },
    ];
    const note = { key: 'note', label: '비고', type: 'textarea' }; // 어느 서식이든 맨 뒤
    return {
      // 원본 703A: 구분·계측기명·제조사·모델/규격·성적서번호·교정대상·교정주기·등록일·
      //            최근교정일·차기교정일·보관위치·사용부서·관리담당자·교정기관·비고
      'assets.gauge': {
        title: '계측기 관리대장',
        asset: true,
        fields: [
          category,
          name,
          maker,
          model,
          { key: 'certNo', label: '성적서 번호', type: 'text' },
          target('교정대상'),
          ...cycle('교정주기(개월)', '최근 교정일', '차기 교정일'),
          registerDate,
          ...place,
          { key: 'agency', label: '교정기관', type: 'text' },
          note,
        ],
      },
      // 원본 706A: 구분·JIG명·교정대상·등록일·보관위치·사용부서·관리담당자·비고
      'assets.jig': {
        title: 'JIG 관리대장',
        asset: true,
        fields: [category, name, target('교정대상'), registerDate, ...place, note],
      },
      // 원본 705A: 구분·치공구명·제조사·점검대상·점검주기·등록일·
      //            신뢰성 점검 확인일·차기 점검 확인일·보관위치·사용부서·관리담당자·점검장비·비고
      'assets.tool': {
        title: '치공구 관리대장',
        asset: true,
        fields: [
          category,
          name,
          maker,
          model,
          target('점검대상'),
          ...cycle('점검주기(개월)', '신뢰성 점검 확인일', '차기 점검 확인일'),
          registerDate,
          ...place,
          { key: 'inspectEquip', label: '점검 장비', type: 'text' },
          note,
        ],
      },
      'assets.handtool': {
        title: '툴 관리대장',
        asset: true,
        fields: [
          category,
          name,
          maker,
          model,
          target('점검대상'),
          ...cycle('점검주기(개월)', '신뢰성 점검 확인일', '차기 점검 확인일'),
          registerDate,
          ...place,
          { key: 'inspectEquip', label: '점검 장비', type: 'text' },
          note,
        ],
      },
    };
  })(),

  // ── 수입검사 ───────────────────────────────────────────────
  'iqc.report': {
    paper: true, // 원본이 병합 많은 한 장짜리 서식 → 양식 낱장으로 입력·출력
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
      // 불량 유형별 건수 — 생산현장에서 체크한 유형과 같은 목록을 쓴다(domain/defectTypes)
      ...defectTypeFields(),
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
      { key: 'defectQty', label: '불량수', type: 'num', col: true },
      { key: 'defectRate', label: '불량지수', type: 'num', calc: 'defectRate' },
      // 생산현황에서 자동으로 채워지는 불량 내역 (판넬 저장 시 갱신)
      { key: 'defectDetail', label: '불량 내역', type: 'textarea' },
      // 유형별 건수도 생산 불량에서 자동 집계된다
      ...defectTypeFields(),
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
    paper: true, // 원본이 병합 많은 한 장짜리 서식 → 양식 낱장으로 입력·출력
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
      // 구분값을 원본 「5M1E 변경요인」 마스터와 일치시켰다 — 골라야 기본 영향도가 제안된다
      {
        key: 'changeCategory',
        label: '5M1E 구분',
        type: 'select',
        options: FACTOR_CATEGORIES,
        required: true,
        col: true,
      },
      { key: 'changeFactor', label: '세부 변경요인', type: 'select', optionsOf: 'factor', col: true },
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
    paper: true, // 원본이 병합 많은 한 장짜리 서식 → 양식 낱장으로 입력·출력
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
    // 원본 IP-603D 의 참석자 서명표(7행 × 6열, 2인씩 3열)를 세로 목록으로 옮겼다.
    // 종이 서명 대신 '확인' 체크로 남긴다 — 전자문서라 자필 서명을 받을 수 없다.
    lines: {
      title: '참석자',
      addLabel: '참석자 추가',
      columns: [
        { key: 'dept', label: '소속', type: 'text', w: '32%' },
        { key: 'name', label: '성명', type: 'text', w: '32%' },
        { key: 'signed', label: '확인', type: 'select', options: ['확인', '미확인'], w: '28%' },
      ],
    },
  },
  'training.grade': {
    paper: true, // 원본이 병합 많은 한 장짜리 서식 → 양식 낱장으로 입력·출력
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
  // 원본 107A — 협력사 마스터. 평가시트가 참조할 업체 목록이 된다.
  'vendor.registry': {
    title: '협력사 등록대장',
    numberPrefix: 'VEN',
    fields: [
      { key: 'vendorType', label: '업체구분', type: 'select', options: ['신규', '정기', '재평가', '기타'], col: true },
      { key: 'supplierName', label: '공급자명', type: 'text', required: true, col: true },
      { key: 'contactName', label: '대표·담당자', type: 'text' },
      { key: 'phone', label: '연락처', type: 'text' },
      { key: 'items', label: '거래품목', type: 'text', col: true },
      { key: 'bizNo', label: '사업자등록번호', type: 'text' },
      { key: 'address', label: '소재지', type: 'text' },
      { key: 'registerDate', label: '등록일', type: 'date' },
      { key: 'evalType', label: '평가구분', type: 'select', options: ['신규', '정기', '재평가', '기타'] },
      { key: 'evalDate', label: '평가일', type: 'date', col: true },
      { key: 'evalScore', label: '평가점수', type: 'num' },
      { key: 'evalGrade', label: '등급', type: 'text' },
      {
        key: 'approveStatus',
        label: '승인여부',
        type: 'select',
        options: ['등록', '보류', '승인', '부적합', '거래중지'],
        col: true,
      },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
  },
  // 원본 107B — 연간 심사 일정. 월별 계획/실적을 ○ 로 표시하던 12칸을 그대로 옮겼다.
  'vendor.plan': {
    title: '협력사 평가계획',
    numberPrefix: 'VPL',
    fields: [
      { key: 'planYear', label: '평가연도', type: 'num', required: true, col: true },
      { key: 'supplierName', label: '업체명', type: 'text', required: true, col: true },
      { key: 'items', label: '주거래 품목', type: 'text', col: true },
      { key: 'auditType', label: '심사구분', type: 'select', options: ['신규', '정기', '재평가', '기타'], col: true },
      { key: 'auditor', label: '심사원', type: 'text' },
      { key: 'auditCycle', label: '심사주기', type: 'select', options: ['1회/년', '2회/년', '4회/년', '수시'] },
      { key: 'planMonth', label: '계획 월', type: 'select', options: MONTHS, required: true, col: true },
      { key: 'doneMonth', label: '실적 월', type: 'select', options: MONTHS, col: true },
      { key: 'planStatus', label: '진행상태', type: 'select', options: ['계획', '완료', '지연', '취소'], col: true },
      { key: 'remarks', label: '비고', type: 'textarea' },
    ],
  },
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
  // 5M1E 세부 변경요인을 고르면 원본 마스터의 기본 영향도를 제안한다.
  // 이미 값이 있으면 건드리지 않는다 — 사람이 판단해 고친 값을 덮어쓰지 않기 위해서다.
  if (formKey === 'change.risk' && out.changeFactor && !out.impactScore) {
    const s2 = suggestImpact(out.changeCategory, out.changeFactor);
    if (s2) out.impactScore = String(s2);
  }
  for (const f of def.fields) {
    if (!f.calc) continue;
    const n = (k) => Number(out[k]) || 0;
    if (f.calc === 'nextDate') {
      out.nextDate = nextCalibrationDate(out.lastDate, out.cycleMonths);
    } else if (f.calc === 'defectRate') {
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

// 대장 표 컬럼 폭·정렬 — 필드 타입으로 정한다.
// 대장이 달라도 '날짜 칸은 늘 같은 폭'이 되도록 여기 한 곳에서 관리한다.
export function colWidthOf(f) {
  if (f.type === 'date') return 'w-date';
  if (f.type === 'num') return 'w-num';
  if (f.type === 'select') return 'w-select';
  if (f.type === 'textarea') return 'w-long';
  return 'w-text';
}
