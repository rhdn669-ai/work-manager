import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPurchases, setPurchaseStatus } from '../../services/purchaseService';
import { useDialog } from '../../components/common/useDialog';
import Skeleton from '../../components/common/Skeleton';

// 종결된 발주 목록 — 정산까지 끝나 보드에서 내린 건들을 모아 본다.
// 삭제가 아니라 옮겨둔 것이므로 언제든 보드로 되돌릴 수 있다.

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function itemStats(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  return { count: items.length, qty: items.reduce((s, it) => s + Number(it.qty || 0), 0) };
}

export default function PurchaseClosedPage() {
  const { confirm, toast } = useDialog();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const all = await getPurchases();
        setRows(all.filter((p) => p.status === 'closed'));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = kw
      ? rows.filter((p) =>
          [p.title, p.supplierName, p.siteName, p.requesterName].some((v) => (v || '').toLowerCase().includes(kw)),
        )
      : rows;
    // 최근에 종결한 것이 위로
    const t = (p) => {
      const d = p.closedAt?.toDate ? p.closedAt.toDate() : p.closedAt ? new Date(p.closedAt) : null;
      return d ? d.getTime() : 0;
    };
    return [...list].sort((a, b) => t(b) - t(a));
  }, [rows, search]);

  const total = useMemo(() => shown.reduce((s, p) => s + Number(p.totalAmount || 0), 0), [shown]);

  async function handleReopen(e, p) {
    e.stopPropagation();
    const ok = await confirm({
      title: '보드로 되돌리기',
      message: `"${p.title}"\n\n종결을 풀고 정산완료 상태로 되돌립니다.`,
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await setPurchaseStatus(p.id, 'settled', { closedAt: null });
      setRows((prev) => prev.filter((x) => x.id !== p.id));
      toast('보드로 되돌렸습니다', 'success');
    } catch {
      toast('되돌리는 중 오류가 발생했습니다', 'error');
    } finally {
      setBusyId('');
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="purchase-list-page">
      <div className="page-header">
        <h2>종결 발주</h2>
      </div>

      <p className="field-hint" style={{ marginBottom: 12 }}>
        정산까지 끝나 보드에서 내린 발주입니다. 삭제된 것이 아니므로 언제든 되돌릴 수 있습니다.
      </p>

      <div className="purchase-filters no-print">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="제목 · 구매처 · 프로젝트 · 등록자 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="purchase-empty">
          {rows.length === 0 ? '종결된 발주가 없습니다.' : '해당 조건의 발주가 없습니다.'}
        </p>
      ) : (
        <>
          <div className="table-scroll-x pur-table-wrap">
            <table className="table pur-table">
              <thead>
                <tr>
                  <th scope="col" className="pur-c-status">
                    상태
                  </th>
                  <th scope="col" className="pur-c-title">
                    제목
                  </th>
                  <th scope="col" className="pur-c-sup">
                    구매처
                  </th>
                  <th scope="col" className="pur-c-proj">
                    프로젝트
                  </th>
                  <th scope="col" className="pur-c-items">
                    품목/수량
                  </th>
                  <th scope="col" className="pur-c-amt">
                    금액
                  </th>
                  <th scope="col" className="pur-c-vat">
                    부가세 포함
                  </th>
                  <th scope="col" className="pur-c-date">
                    작성일
                  </th>
                  <th scope="col" className="pur-c-date">
                    종결일
                  </th>
                  <th scope="col" className="pur-c-act col-action">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const amt = Number(p.totalAmount || 0);
                  return (
                    <tr key={p.id} className="pur-row" onClick={() => navigate(`/admin/purchase/${p.id}`)}>
                      <td data-label="상태">
                        <span className="purchase-badge purchase-badge-closed">종결</span>
                      </td>
                      <td data-label="제목" className="pur-c-title">
                        <div className="pur-title u-ellipsis-1" title={p.title || ''}>
                          {p.title || '-'}
                        </div>
                        {p.subtitle && (
                          <div className="pur-sub u-ellipsis-1" title={p.subtitle}>
                            {p.subtitle}
                          </div>
                        )}
                      </td>
                      <td data-label="구매처" className="pur-c-sup u-ellipsis-1" title={p.supplierName || ''}>
                        {p.supplierName || '-'}
                      </td>
                      <td data-label="프로젝트" className="pur-c-proj u-ellipsis-1" title={p.siteName || ''}>
                        {p.siteName || '프로젝트 미지정'}
                      </td>
                      <td data-label="품목/수량" className="pur-c-items pur-items">
                        품목 {itemStats(p).count} · 수량 {itemStats(p).qty}
                      </td>
                      <td data-label="금액" className="pur-c-amt pur-amt">
                        {amt.toLocaleString()}원
                      </td>
                      <td data-label="부가세 포함" className="pur-c-vat pur-vat">
                        {Math.round(amt * 1.1).toLocaleString()}원
                      </td>
                      <td data-label="작성일" className="pur-c-date">
                        {fmtDate(p.createdAt || p.orderedAt)}
                      </td>
                      <td data-label="종결일" className="pur-c-date">
                        {fmtDate(p.closedAt)}
                      </td>
                      <td data-label="작업" className="pur-c-act col-action" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={(e) => handleReopen(e, p)}
                            disabled={busyId === p.id}
                          >
                            되돌리기
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="pur-closed-sum">
            {shown.length}건 · 합계 {total.toLocaleString()}원 (부가세 포함 {Math.round(total * 1.1).toLocaleString()}
            원)
          </p>
        </>
      )}
    </div>
  );
}
