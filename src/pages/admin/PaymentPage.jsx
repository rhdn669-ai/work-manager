import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDialog } from '../../components/common/DialogProvider';
import Icon from '../../components/common/Icon';
import { getPurchases, getSuppliers, subscribePurchaseItems, unmarkSupplierPaid } from '../../services/purchaseService';
import { mapPrintItems, computeSupplierList } from '../../utils/purchaseOrder';

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// 결제 완료 표시된 (발주 × 업체) 건을 모아 보여주는 페이지
export default function PaymentPage() {
  const navigate = useNavigate();
  const { confirm, toast } = useDialog();
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, sp] = await Promise.all([getPurchases(), getSuppliers()]);
      setPurchases(ps);
      setSuppliers(sp);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribePurchaseItems(setItemMaster);
    return () => unsub();
  }, [load]);

  // 결제 완료된 (발주, 업체) 행 목록
  const rows = useMemo(() => {
    const out = [];
    for (const p of purchases) {
      const paidMap = p.supplierPaid;
      if (!paidMap || Object.keys(paidMap).length === 0) continue;
      const lines = mapPrintItems(p.items || [], itemMaster, suppliers);
      const supList = computeSupplierList(p.items || [], itemMaster, suppliers, p);
      for (const sup of supList) {
        const key = sup.name.replace(/\./g, '_');
        const paid = paidMap[key];
        if (!paid) continue;
        const amount = lines
          .filter((l) => (l._supplier || '(구매처 미지정)') === sup.name)
          .reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
        out.push({
          purchaseId: p.id,
          title: p.title || '(제목 없음)',
          siteName: p.siteName || '',
          supplier: sup.name,
          amount,
          paidAt: paid.paidAt,
          paidBy: paid.paidBy || '',
        });
      }
    }
    out.sort((a, b) => {
      const ta = a.paidAt?.toMillis ? a.paidAt.toMillis() : new Date(a.paidAt || 0).getTime();
      const tb = b.paidAt?.toMillis ? b.paidAt.toMillis() : new Date(b.paidAt || 0).getTime();
      return tb - ta;
    });
    return out;
  }, [purchases, itemMaster, suppliers]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(kw) ||
        r.supplier.toLowerCase().includes(kw) ||
        (r.siteName || '').toLowerCase().includes(kw),
    );
  }, [rows, search]);

  const totalAmount = filtered.reduce((s, r) => s + r.amount, 0);

  async function cancelPaid(r) {
    if (!(await confirm({ title: '결제 취소', message: `"${r.supplier}" 결제 완료를 취소할까요?\n결제 목록에서 빠집니다.` })))
      return;
    try {
      await unmarkSupplierPaid(r.purchaseId, r.supplier);
      setPurchases((prev) =>
        prev.map((p) => {
          if (p.id !== r.purchaseId) return p;
          const next = { ...(p.supplierPaid || {}) };
          delete next[r.supplier.replace(/\./g, '_')];
          return { ...p, supplierPaid: next };
        }),
      );
      toast('결제 완료를 취소했습니다.');
    } catch (err) {
      toast('취소 오류: ' + (err.message || err), 'error');
    }
  }

  return (
    <div className="payment-page">
      <div className="page-header">
        <h2>결제</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={load} disabled={loading}>
            <Icon name="restore" className="btn-ic" />
            새로고침
          </button>
        </div>
      </div>
      <p className="field-hint" style={{ margin: '0 0 12px' }}>
        발주 상세에서 <strong>결제 완료</strong>로 표시한 건이 여기에 모입니다. 업체별로 한 줄씩 표시됩니다.
      </p>

      <div className="lib-search-inline" style={{ marginBottom: 12, maxWidth: 360 }}>
        <input
          type="search"
          placeholder="발주 제목 · 업체 · 프로젝트 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="검색"
        />
      </div>

      {loading ? (
        <p className="text-muted">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <div className="trash-empty">결제 완료로 표시된 발주가 없습니다.</div>
      ) : (
        <div className="table-scroll-x">
          <table className="table cards-sm">
            <thead>
              <tr>
                <th>발주 제목</th>
                <th style={{ width: 140 }}>프로젝트</th>
                <th style={{ width: 160 }}>업체</th>
                <th style={{ width: 120 }}>금액(공급가)</th>
                <th style={{ width: 110 }}>결제일</th>
                <th style={{ width: 80 }}>결제자</th>
                <th className="col-action" style={{ width: 160 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.purchaseId}-${r.supplier}`}>
                  <td data-label="발주 제목">
                    <strong>{r.title}</strong>
                  </td>
                  <td data-label="프로젝트">{r.siteName || '-'}</td>
                  <td data-label="업체">{r.supplier}</td>
                  <td data-label="금액(공급가)" style={{ textAlign: 'right' }}>
                    {r.amount.toLocaleString()}원
                  </td>
                  <td data-label="결제일">{fmtDate(r.paidAt)}</td>
                  <td data-label="결제자">{r.paidBy || '-'}</td>
                  <td data-label="작업" className="col-action">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => navigate(`/admin/purchase/${r.purchaseId}`)}
                      >
                        <Icon name="chevronRight" className="btn-ic" />발주서
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => cancelPaid(r)}>
                        <Icon name="trash" className="btn-ic" />결제 취소
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 700 }}>
                  합계 ({filtered.length}건)
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{totalAmount.toLocaleString()}원</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
