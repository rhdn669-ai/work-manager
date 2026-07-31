import { BUPMOK } from './production';
import { DEFECT_TYPES, countByType } from './defectTypes';

// 생산현황 판넬 → 품질보증 「출하·부적합 > 부적합 실적」 연동 규칙 (2026-07-31 대표님 확정)
//  · 판넬(호기) 1대 = 부적합 1건        · 처리 전(미완료)·후(완료) 불량 모두 대상
//  · 고객사는 판넬의 회사(메티스·디에이치)를 그대로 씀
// 여기서는 "생산에서 나온 사실"만 만든다. 조치·대책·검증이력·판정·문서번호는 품질팀 소유라
// 동기화가 건드리지 않는다(qualityRecordService.syncPanelNcr 참조).

export const NCR_FORM_KEY = 'oqc.ncr';

// 판넬의 검수 1·2차 공정비고에 쌓인 불량 항목을 부품·차수와 함께 평탄화
export function collectPanelDefects(panel) {
  const insp = panel?.검수 || {};
  const out = [];
  [1, 2].forEach((n) => {
    BUPMOK.forEach((box) => {
      const items = insp[`차${n}`]?.공정비고?.[box]?.항목 || [];
      items.forEach((it) => {
        if (!it.내용 && !it.사진) return; // 사진만 있는 불량도 집계 (불량현황과 같은 규칙)
        out.push({
          차수: `${n}차`,
          부품: box,
          내용: it.내용 || '(사진 불량)',
          유형: it.유형 || '',
          완료: !!it.완료,
        });
      });
    });
  });
  return out;
}

// 불량 목록 → 대장·양식에서 그대로 읽히는 한 덩어리 텍스트
function describe(defects) {
  return defects
    .map((d) => `[${d.차수} ${d.부품}${d.유형 ? ` · ${d.유형}` : ''}] ${d.내용}${d.완료 ? ' (조치완료)' : ''}`)
    .join('\n');
}

// 검사 단위 수 — 작업자가 배정된 부품 개수(없으면 부품 전체 수를 쓴다)
function inspectedUnits(panel) {
  const workers = panel?.검수?.공정작업자 || {};
  const n = BUPMOK.filter((b) => workers[b]).length;
  return n || BUPMOK.length;
}

// 유형 칸은 0으로 시작해야 이전 집계가 남지 않는다(유형을 바꿨을 때 옛 값이 그대로 붙는 것 방지)
const zeroTypes = () => Object.fromEntries(DEFECT_TYPES.map((t) => [t.key, 0]));

// 판넬 → 부적합 실적의 "생산 유래 필드"만. 불량이 없으면 null.
export function panelToNcrFacts(panel) {
  const defects = collectPanelDefects(panel);
  if (!defects.length) return null;
  const open = defects.filter((d) => !d.완료).length;
  return {
    customerName: panel.회사 || '',
    itemName: [panel.프로젝트, panel.호기].filter(Boolean).join(' · ') || '(호기 미지정)',
    projectNo: panel.프로젝트 || '',
    equipmentName: panel.자재 || '',
    processType: '공정검사',
    // 검사수 = 그 판넬에서 작업자가 배정된 부품 수. 1(판넬 1대)로 두면
    // 불량 3건짜리 판넬이 불량률 300% 로 잡혀 추이가 망가진다.
    inspectedQty: inspectedUnits(panel),
    defectQty: defects.length,
    openQty: open,
    defectDetail: describe(defects),
    // 현장에서 고른 불량 유형을 그대로 유형별 건수로 집계
    ...zeroTypes(),
    ...countByType(defects),
  };
}
