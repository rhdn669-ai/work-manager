// 대장 셀 — 엑셀처럼 칸을 직접 고치고, 값이 바뀐 것만 저장한다.
// 외형은 앱 공통 인라인 편집 표준(.inline-edit-table)에 맡긴다 —
// 구매 품목·발주 상세·BOM 상세가 쓰는 그 스타일이다. 여기서 따로 만들지 않는다.
//   f        : 서식 필드 정의 { key, type, options }
//   row      : 그 행의 문서
//   onCommit : (row, key, value) => Promise — 값이 바뀌었을 때만 호출된다
//   readOnly : 자동계산 칸이나 외부(생산현황)가 원본인 칸
export default function LedgerCell({ f, row, onCommit, readOnly }) {
  const v = row[f.key] ?? '';
  // 읽기 전용도 입력칸과 같은 높이·여백을 써야 같은 표 안에서 오와열이 맞는다
  if (readOnly) return <span className="cell-text">{v || '—'}</span>;
  if (f.type === 'select') {
    return (
      <select value={v} onChange={(e) => onCommit(row, f.key, e.target.value)}>
        <option value="" />
        {(f.options || []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={f.type === 'num' ? 'number' : f.type === 'date' ? 'date' : 'text'}
      defaultValue={v}
      onBlur={(e) => onCommit(row, f.key, e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}
