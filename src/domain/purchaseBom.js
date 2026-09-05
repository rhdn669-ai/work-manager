// 발주서 ↔ BOM 직결 (2026-09-05 대표님 안 B 3단계).
//
// 발주서가 어느 BOM(프로젝트·타입)에서 왔는지 스스로 기억한다 — 도급 배정이 「어느 현장 발주서를
// 셀지」 설정으로 매핑하던 일을 없애기 위해서. 한 발주서에 타입 두 개(프로버·M7H)를 담을 수 있어
// 목록으로 둔다. bomProjectId 는 조회용 대표 프로젝트(첫 번째 링크).

/** 같은 프로젝트·타입은 한 번만 — [{ projectId, projectName, variantKey, variantLabel }] */
export function mergeBomLinks(list, link) {
  const cur = Array.isArray(list) ? list.filter((l) => l && l.projectId) : [];
  if (!link?.projectId) return cur;
  const next = {
    projectId: String(link.projectId),
    projectName: String(link.projectName || ''),
    variantKey: String(link.variantKey || ''),
    variantLabel: String(link.variantLabel || ''),
  };
  if (cur.some((l) => l.projectId === next.projectId && (l.variantKey || '') === next.variantKey)) return cur;
  return [...cur, next];
}

/** 발주서의 대표 BOM 프로젝트 id — 링크 목록의 첫 것 */
export function primaryBomProjectId(purchase) {
  const links = Array.isArray(purchase?.bomLinks) ? purchase.bomLinks : [];
  return purchase?.bomProjectId || links[0]?.projectId || '';
}

/** 「프로버 (메티스) · T5391, M7H」 — 발주 상세 표시용 */
export function bomLinksLabel(links) {
  const list = Array.isArray(links) ? links.filter((l) => l && l.projectId) : [];
  if (list.length === 0) return '';
  const name = list[0].projectName || '';
  const types = list.map((l) => l.variantLabel).filter(Boolean);
  return types.length ? `${name} · ${types.join(', ')}` : name;
}
