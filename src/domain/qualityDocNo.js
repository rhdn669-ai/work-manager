// 품질 문서번호 채번 — 서식의 기본 번호 뒤에 -0001 부터 순서대로 붙인다.
//   QP-104A → QP-104A-0001, QP-104A-0002 …
//
// 세는 범위는 「양식」이 아니라 「기본 번호」다.
// 치공구·툴이 둘 다 QP-705A 를, 출하검사 실적·품질목표가 둘 다 QP-105B 를 쓰기 때문에
// 양식별로 세면 같은 번호가 두 장 생긴다.
//
// 빈 자리를 메우지 않고 항상 「가장 큰 번호 + 1」을 준다 — 지운 기록의 번호를
// 다시 쓰면 대장·성적서를 대조할 때 같은 번호의 다른 문서가 두 벌 남는다.

const PAD = 4;

export function nextDocNo(prefix, usedNos) {
  if (!prefix) return ''; // 기본 번호가 없는 서식(인원 명부)은 직접 입력
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const no of usedNos || []) {
    const m = re.exec(String(no ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}-${String(max + 1).padStart(PAD, '0')}`;
}
