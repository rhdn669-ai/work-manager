// 여러 줄을 한 번에 옮기기 (2026-09-04 대표님 「여러 개 체크하고 한 번에 이동」).
//
// 체크한 줄 중 하나를 끌면 체크한 줄 «전부»가 서로의 차례를 지킨 채 놓은 자리로 간다.
// 체크 안 한 줄을 끌면 그 줄 하나만 움직인다(체크와 무관).

/**
 * @param {string[]} ids      지금 차례
 * @param {Iterable<string>} selected  체크한 id 들
 * @param {string} activeId   끈 줄
 * @param {string} overId     놓은 자리의 줄
 * @returns {string[]}        새 차례 (바뀐 게 없으면 같은 배열 내용)
 */
export function moveMany(ids, selected, activeId, overId) {
  const list = ids.slice();
  const from = list.indexOf(activeId);
  const to = list.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return list;
  const sel = new Set(selected || []);
  const group = sel.has(activeId) && sel.size > 1 ? list.filter((id) => sel.has(id)) : [activeId];
  if (group.includes(overId)) return list; // 묶음 안에 놓으면 그대로
  const rest = list.filter((id) => !group.includes(id));
  // 아래로 끌면 over 뒤, 위로 끌면 over 앞 — 눈에 보인 그대로
  const overIdx = rest.indexOf(overId);
  const at = from < to ? overIdx + 1 : overIdx;
  rest.splice(at, 0, ...group);
  return rest;
}
