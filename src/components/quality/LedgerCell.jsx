// 대장 셀 — 엑셀처럼 칸을 직접 고치고, 값이 바뀐 것만 저장한다.
// 페이지를 옮기거나 창을 띄우지 않는다 (2026-08-02 대표님: 대장은 리스트에서 다 본다).
//   f        : 서식 필드 정의 { key, type, options }
//   row      : 그 행의 문서
//   onCommit : (row, key, value) => Promise — 값이 바뀌었을 때만 호출된다
//   readOnly : 자동계산 칸이나 외부(생산현황)가 원본인 칸
export default function LedgerCell({ f, row, onCommit, readOnly }) {
  const v = row[f.key] ?? '';
  if (readOnly) return <span className="q-lcell is-read">{v || '—'}</span>;
  if (f.type === 'select') {
    return (
      <select className="q-lcell" value={v} onChange={(e) => onCommit(row, f.key, e.target.value)}>
        <option value="" />
        {(f.options || []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (f.type === 'textarea') {
    return (
      <input
        className="q-lcell"
        type="text"
        defaultValue={v}
        onBlur={(e) => onCommit(row, f.key, e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    );
  }
  return (
    <input
      className="q-lcell"
      type={f.type === 'num' ? 'number' : f.type === 'date' ? 'date' : 'text'}
      defaultValue={v}
      onBlur={(e) => onCommit(row, f.key, e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}
