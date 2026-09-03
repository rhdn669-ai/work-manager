// 판넬(호기) ↔ BOM 연결 (2026-09-03 대표님 「생산 현황에 호기별로 자재 사급 도급 리스트를」).
//
// 판넬 문서의 bomLink 한 필드에 담는다.
//   { projectId, projectName, variantKey, variantLabel }
// BOX 는 대응표가 필요 없다 — 판넬과 BOM 이 같은 이름을 쓴다(domain/boxes.js).
// projectName·variantLabel 은 표시용 스냅샷이다. BOM 쪽에서 이름을 고치면 다음에
// 연결 화면을 열 때 갱신된다 — 연결 자체는 id 로 붙들어 이름이 바뀌어도 끊기지 않는다.

import { PANEL_BOXES } from './boxes';

/** 호기 자재 체크 대상 BOX — MP 는 하위 9종을 따로 관리하므로 뺀다 */
export const CHECKABLE_BOXES = PANEL_BOXES.filter((b) => b !== 'MP');

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
export function bomRowsForBox(rows, box) {
  const b = String(box || '').trim();
  return (rows || []).filter((r) => String(r.box || '').trim() === b);
}
