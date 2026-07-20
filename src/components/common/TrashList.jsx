// 휴지통 표(표시 전용) — 모달(TrashModal)과 전역 휴지통 페이지(TrashPage)가 공유.
// 데이터 로드·핸들러는 부모가 제공하고, 여기서는 렌더링만 한다(양식 분기 방지).
//   items     : trash 문서 배열
//   loading   : 로딩 중 여부
//   busy      : 처리 중인 항목 id (버튼 비활성화)
//   onRestore : (id) => void
//   onPurge   : (id) => void
//   canPurge  : 영구삭제 버튼 노출 여부 (관리자만 true)
//   emptyText : 비었을 때 문구

const TRASH_TYPE_LABEL = {
  departments: { label: '부서', cls: 'ordered' },
  events: { label: '행사', cls: 'partial' },
  vendors: { label: '업체', cls: 'received' },
  freelancers: { label: '프리랜서', cls: 'received' },
  purchaseItems: { label: '품목', cls: 'ordered' },
  quotes: { label: '견적', cls: 'partial' },
  suppliers: { label: '구매처', cls: 'settled' },
  users: { label: '직원', cls: 'settled' },
  sites: { label: '현장', cls: 'ordered' },
  libraryFiles: { label: '파일', cls: 'partial' },
  libraryFolders: { label: '폴더', cls: 'received' },
  purchase: { label: '발주', cls: 'ordered' },
  bomProject: { label: 'BOM', cls: 'partial' },
  bom: { label: 'BOM 품목', cls: 'partial' },
  mileageLogs: { label: '운행기록', cls: 'partial' },
  vehicleMileages: { label: '운행기록', cls: 'partial' },
  siteClosingItems: { label: '공수표', cls: 'received' },
  siteFinances: { label: '지출·매출', cls: 'settled' },
  overtimeRecords: { label: '잔업', cls: 'ordered' },
  leaves: { label: '연차', cls: 'partial' },
  tasks: { label: '업무', cls: 'ordered' },
  personalEvents: { label: '개인일정', cls: 'received' },
  productionPanels: { label: '생산판넬', cls: 'ordered' },
};

function trashTypeInfo(t) {
  return TRASH_TYPE_LABEL[t.type] || TRASH_TYPE_LABEL[t.collection] || { label: t.type || '-', cls: 'ordered' };
}

function fmtDateTime(d) {
  try {
    const dt = d?.toDate ? d.toDate() : d?.seconds ? new Date(d.seconds * 1000) : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  } catch {
    return '';
  }
}

export default function TrashList({
  items,
  loading,
  busy,
  onRestore,
  onPurge,
  canPurge = false,
  emptyText = '휴지통이 비어 있습니다.',
}) {
  if (loading) return <div className="trash-empty">불러오는 중...</div>;
  if (!items || items.length === 0) return <div className="trash-empty">{emptyText}</div>;

  return (
    <div className="table-scroll-x">
      <table className="table cards-sm trash-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>구분</th>
            <th style={{ width: '30%' }}>이름</th>
            <th>내용</th>
            <th style={{ width: 130 }}>삭제일시</th>
            <th style={{ width: 76 }}>삭제자</th>
            <th className="col-action" style={{ width: canPurge ? 168 : 80, minWidth: canPurge ? 168 : 80 }}>
              작업
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const { label, cls } = trashTypeInfo(t);
            return (
              <tr key={t.id}>
                <td data-label="구분">
                  <span className={`purchase-badge purchase-badge-${cls}`}>{label}</span>
                </td>
                <td data-label="이름">
                  <strong>{t.title || '(이름 없음)'}</strong>
                </td>
                <td data-label="내용" style={{ color: 'var(--accent)', fontSize: 13 }}>
                  {t.summary || '-'}
                </td>
                <td data-label="삭제일시">{fmtDateTime(t.deletedAt)}</td>
                <td data-label="삭제자">{t.deletedByName || '-'}</td>
                <td data-label="작업" className="col-action">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={busy === t.id}
                    onClick={() => onRestore(t.id)}
                    style={canPurge ? { marginRight: 6 } : undefined}
                  >
                    복원
                  </button>
                  {canPurge && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy === t.id}
                      onClick={() => onPurge(t.id)}
                    >
                      영구삭제
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
