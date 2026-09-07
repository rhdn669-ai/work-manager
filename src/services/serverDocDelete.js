// 사내 서버에서 «줄 하나 지우기» — 저수준 도구.
//
// 앱의 삭제 규칙은 그대로다: 화면에서 지우는 것은 전부 휴지통(trashGeneric)을 거치고,
// 여기까지 내려오는 것은 관리자가 휴지통에서 «영구 삭제»를 누른 경우뿐이다.
// (Firestore 를 쓸 때 trashService 가 마지막에 부르던 자리를 그대로 대신한다.)
export async function removeRow(sb, table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw new Error(`${table} 삭제 실패: ${error.message}`);
}
