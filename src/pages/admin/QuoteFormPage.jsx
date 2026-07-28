import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getQuoteById, addQuote, updateQuote } from '../../services/quoteService';
import { getSuppliers } from '../../services/purchaseService';
import { trashGeneric } from '../../services/trashService';
import { useAuth } from '../../contexts/useAuth';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/useDialog';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import PdfFabGroup from '../../components/common/PdfFabGroup';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
import { SELF_INFO } from '../../utils/purchaseOrder';
import QuotePrintForm, { DEFAULT_NOTE } from './QuotePrintForm';

const EMPTY_LINE = { name: '', spec: '', unit: '', qty: 0, unitPrice: 0, note: '' };
const EMPTY_FORM = {
  title: '',
  supplierId: '',
  supplierName: '',
  siteName: '',
  items: [{ ...EMPTY_LINE }],
  validity: '15일',
  delivery: '일정에 준함',
  payment: '협의',
  note: DEFAULT_NOTE,
};

export default function QuoteFormPage() {
  const { quoteId } = useParams();
  const navigate = useNavigate();
  const isNew = !quoteId;
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();

  const [loading, setLoading] = useState(!isNew);
  const [quote, setQuote] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [isEditing, setIsEditing] = useState(isNew);
  const [form, setForm] = useState({ ...EMPTY_FORM, items: [{ ...EMPTY_LINE }] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSuppliers().then(setSuppliers).catch(console.error);
  }, []);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    getQuoteById(quoteId)
      .then((q) => {
        if (!q) {
          navigate('/admin/purchase/quotes', { replace: true });
          return;
        }
        setQuote(q);
        setForm({
          title: q.title || '',
          supplierId: q.supplierId || '',
          supplierName: q.supplierName || '',
          siteName: q.siteName || '',
          items: q.items?.length ? q.items.map((it) => ({ ...EMPTY_LINE, ...it })) : [{ ...EMPTY_LINE }],
          validity: q.validity || '15일',
          delivery: q.delivery || '일정에 준함',
          payment: q.payment || '협의',
          note: q.note || DEFAULT_NOTE,
        });
      })
      .catch(() => navigate('/admin/purchase/quotes', { replace: true }))
      .finally(() => setLoading(false));
  }, [quoteId, isNew, navigate]);

  const supplyAmount = useMemo(
    () => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0),
    [form.items],
  );
  const totalQty = useMemo(() => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0), 0), [form.items]);
  const vatAmount = Math.round(supplyAmount * 0.1);
  const grandTotal = supplyAmount + vatAmount;

  // 견적서 양식에 표시할 발행번호 미리보기 — 실제 채번은 저장 후 QuotePrintForm과 동일 규칙으로 확정됨
  function previewQuoteNumber() {
    if (isNew) return '(저장 시 자동 발급)';
    const d = quote?.createdAt?.toDate
      ? quote.createdAt.toDate()
      : quote?.createdAt
        ? new Date(quote.createdAt)
        : new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const idTail = (quoteId || '').slice(0, 4).toUpperCase();
    return `IOPN-Q${yyyy}${mm}${dd}-${idTail}`;
  }

  function updateLine(idx, patch) {
    setForm((f) => ({ ...f, items: f.items.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)) }));
  }
  function addLine() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_LINE }] }));
  }
  function removeLine(idx) {
    setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items }));
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!form.title.trim()) {
      alert('제목을 입력해주세요.');
      return;
    }
    const lines = form.items.filter((ln) => (ln.name || '').trim());
    const items = lines.map((ln) => ({
      name: ln.name,
      spec: ln.spec || '',
      unit: ln.unit || '',
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      amount: (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0),
      note: ln.note || '',
    }));
    const totalAmount = items.reduce((s, it) => s + it.amount, 0);
    const vat = Math.round(totalAmount * 0.1);
    const supplier = suppliers.find((s) => s.id === form.supplierId);
    const payload = {
      title: form.title.trim(),
      supplierId: form.supplierId,
      supplierName: supplier?.name || form.supplierName || '',
      siteName: form.siteName || '',
      items,
      totalAmount,
      vat,
      grandTotal: totalAmount + vat,
      validity: form.validity || '15일',
      delivery: form.delivery || '일정에 준함',
      payment: form.payment || '협의',
      note: form.note || DEFAULT_NOTE,
    };
    try {
      setSaving(true);
      if (isNew) {
        const docRef = await addQuote(payload);
        navigate(`/admin/purchase/quotes/${docRef.id}`, { replace: true });
      } else {
        await updateQuote(quoteId, payload);
        const updated = { ...quote, ...payload };
        setQuote(updated);
        setIsEditing(false);
        toast('저장되었습니다.');
      }
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await confirm(`"${quote?.title}" 견적서를 삭제하시겠습니까?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      await trashGeneric(
        'quotes',
        quoteId,
        { title: quote?.title || '', summary: [quote?.supplierName, quote?.siteName].filter(Boolean).join(' · ') },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      navigate('/admin/purchase/quotes');
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  function handleCancel() {
    if (isNew) navigate('/admin/purchase/quotes');
    else setIsEditing(false);
  }

  const printQuote = isEditing
    ? {
        ...form,
        id: quoteId || 'new',
        createdAt: quote?.createdAt || new Date(),
        totalAmount: supplyAmount,
        vat: vatAmount,
        grandTotal,
      }
    : quote;

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="quote-detail-page printable-page">
      <style>{`
        .quote-detail-page .page-header { gap: 8px; flex-wrap: wrap; }
        .quote-detail-page .page-header h2 { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .quote-form-body { width: 100%; }
        .quote-form-body .form-group { margin-bottom: 14px; }
        .field-hint-inline { font-weight: 400; color: var(--text-secondary); font-size: 0.85em; }
        /* 견적서 양식을 그대로 편집 화면으로 사용 — 정보표·특이사항 셀 안의 입력요소를 텍스트처럼 보이게 */
        .quote-edit-surface { overflow-x: auto; }
        .quote-edit-surface .iopn-info-table .val,
        .quote-edit-surface .iopn-notes-table .val { padding: 0; }
        .quote-edit-surface .iopn-info-table .val .quote-inline-input,
        .quote-edit-surface .iopn-info-table .val .ds-select__trigger,
        .quote-edit-surface .iopn-notes-table .val .quote-inline-textarea {
          width: 100%; border: none; background: transparent; padding: 5px 10px;
          font: inherit; font-size: 11.5px; box-sizing: border-box; color: inherit; text-align: left;
        }
        .quote-edit-surface .iopn-notes-table .val .quote-inline-textarea { resize: vertical; display: block; }
        .quote-edit-surface .iopn-info-table .val .quote-inline-input:focus,
        .quote-edit-surface .iopn-notes-table .val .quote-inline-textarea:focus,
        .quote-edit-surface .iopn-info-table .val .ds-select.is-open .ds-select__trigger {
          outline: 2px solid var(--primary); outline-offset: -2px; background: var(--bg-card);
        }
        .quote-edit-surface .iopn-info-table .val .ds-select { width: 100%; }
        .quote-edit-surface .quote-supplier-manual { margin-top: 2px; }
        .quote-add-line-btn { margin-top: 8px; }
        /* 견적서 양식 표에서 셀 직접 편집(엑셀식) — 품목표 */
        .quote-edit-wrap { overflow-x: auto; margin-top: 6px; }
        .quote-edit-table { min-width: 660px; }
        .quote-edit-table td { padding: 0; vertical-align: middle; }
        .quote-edit-table td.c-no { padding: 4px 6px; text-align: center; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
        .quote-edit-table td.c-amount { padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums; }
        .quote-edit-table input { width: 100%; border: none; background: transparent; padding: 8px; font: inherit; font-size: 11.5px; box-sizing: border-box; color: inherit; }
        .quote-edit-table input::placeholder { color: var(--text-muted); }
        .quote-edit-table input:focus { outline: 2px solid var(--primary); outline-offset: -2px; background: var(--bg-card); }
        .quote-edit-table td.c-qty input, .quote-edit-table td.c-price input { text-align: right; }
        .quote-edit-table th.c-del, .quote-edit-table td.c-del { width: 34px; padding: 0; text-align: center; }
        .quote-cell-del { border: none; background: transparent; color: var(--danger); cursor: pointer; padding: 5px; display: inline-flex; align-items: center; justify-content: center; }
        .quote-cell-del:hover { opacity: 0.7; }
        .quote-preview-wrap { overflow-x: auto; }
        .quote-preview-wrap .print-form-iopn { min-width: 600px; }
        @media (max-width: 600px) { .quote-preview-wrap .print-form-iopn { min-width: unset; } }
      `}</style>

      {/* 화면용 헤더 */}
      <div className="page-header screen-only">
        <button type="button" className="btn btn-sm btn-outline" onClick={handleCancel}>
          <Icon name="chevronDown" style={{ transform: 'rotate(90deg)', display: 'block' }} />
          {isEditing && !isNew ? '취소' : '목록'}
        </button>
        <h2>{isNew ? '새 견적서' : isEditing ? '견적서 수정' : quote?.title || '견적서'}</h2>
        <div className="page-actions">
          {isEditing ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving}>
              <Icon name="check" className="btn-ic" />
              {saving ? '저장 중...' : '저장'}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setIsEditing(true)}>
                <Icon name="edit" className="btn-ic" />
                수정
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={handleDelete}>
                <Icon name="trash" className="btn-ic" />
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      {/* 편집 폼 — 견적서 양식 그대로에서 셀을 직접 편집 */}
      {isEditing && (
        <form className="quote-form-body screen-only" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>
              제목 * <span className="field-hint-inline">(목록 표시용 내부 제목 — 견적서에는 인쇄되지 않습니다)</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예) STAGE 1SET"
              required
              autoFocus={isNew}
            />
          </div>

          <div className="print-form-iopn quote-form quote-edit-surface">
            <IopnDocBrand title="견 적 서" />

            <table className="iopn-info-table">
              <tbody>
                <tr>
                  <th className="lbl">수 신</th>
                  <td className="val">
                    <Select
                      className="quote-inline-select"
                      value={form.supplierId}
                      onChange={(v) => {
                        const s = suppliers.find((x) => x.id === v);
                        setForm({ ...form, supplierId: v, supplierName: s?.name || form.supplierName });
                      }}
                      options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                      ariaLabel="거래처 선택"
                      placeholder="거래처 선택"
                    />
                    {!form.supplierId && (
                      <input
                        type="text"
                        className="quote-inline-input quote-supplier-manual"
                        value={form.supplierName}
                        onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                        placeholder="목록에 없으면 직접 입력"
                      />
                    )}
                  </td>
                  <th className="lbl">사업자등록번호</th>
                  <td className="val">{SELF_INFO.businessNumber}</td>
                </tr>
                <tr>
                  <th className="lbl">프로젝트</th>
                  <td className="val">
                    <input
                      type="text"
                      className="quote-inline-input"
                      value={form.siteName}
                      onChange={(e) => setForm({ ...form, siteName: e.target.value })}
                      placeholder="예) SEMES 프로버설비"
                    />
                  </td>
                  <th className="lbl">회사명/대표</th>
                  <td className="val">{SELF_INFO.companyAndCeo}</td>
                </tr>
                <tr>
                  <th className="lbl">발행번호</th>
                  <td className="val">{previewQuoteNumber()}</td>
                  <th className="lbl">주 소</th>
                  <td className="val">{SELF_INFO.address}</td>
                </tr>
                <tr>
                  <th className="lbl">유효기간</th>
                  <td className="val">
                    <input
                      type="text"
                      className="quote-inline-input"
                      value={form.validity}
                      onChange={(e) => setForm({ ...form, validity: e.target.value })}
                    />
                  </td>
                  <th className="lbl">TEL/FAX</th>
                  <td className="val">{SELF_INFO.telFax}</td>
                </tr>
                <tr>
                  <th className="lbl">납품기일</th>
                  <td className="val">
                    <input
                      type="text"
                      className="quote-inline-input"
                      value={form.delivery}
                      onChange={(e) => setForm({ ...form, delivery: e.target.value })}
                    />
                  </td>
                  <th className="lbl">E-Mail</th>
                  <td className="val">{SELF_INFO.email}</td>
                </tr>
                <tr>
                  <th className="lbl">지불조건</th>
                  <td className="val">
                    <input
                      type="text"
                      className="quote-inline-input"
                      value={form.payment}
                      onChange={(e) => setForm({ ...form, payment: e.target.value })}
                    />
                  </td>
                  <th className="lbl">담당/연락처</th>
                  <td className="val">{SELF_INFO.contact}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="iopn-amount-row">
                    금 액 : ₩ {supplyAmount.toLocaleString()}원 / VAT 별도
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="quote-edit-wrap">
              <table className="iopn-items-table quote-cols quote-edit-table">
                <thead>
                  <tr>
                    <th className="c-no">NO</th>
                    <th className="c-name">품목명</th>
                    <th className="c-spec">규격</th>
                    <th className="c-unit">단위</th>
                    <th className="c-qty">수량</th>
                    <th className="c-price">단가</th>
                    <th className="c-amount">금액</th>
                    <th className="c-note">비고</th>
                    <th className="c-del" aria-label="삭제"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((ln, idx) => (
                    <tr key={idx}>
                      <td className="c-no">{idx + 1}</td>
                      <td className="c-name">
                        <input
                          type="text"
                          placeholder="품명"
                          value={ln.name}
                          title={ln.name || ''}
                          onChange={(e) => updateLine(idx, { name: e.target.value })}
                        />
                      </td>
                      <td className="c-spec">
                        <input
                          type="text"
                          placeholder="규격"
                          value={ln.spec}
                          title={ln.spec || ''}
                          onChange={(e) => updateLine(idx, { spec: e.target.value })}
                        />
                      </td>
                      <td className="c-unit">
                        <input
                          type="text"
                          placeholder="단위"
                          value={ln.unit}
                          onChange={(e) => updateLine(idx, { unit: e.target.value })}
                        />
                      </td>
                      <td className="c-qty">
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={ln.qty || ''}
                          onChange={(e) => updateLine(idx, { qty: e.target.value })}
                        />
                      </td>
                      <td className="c-price">
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={ln.unitPrice || ''}
                          onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                        />
                      </td>
                      <td className="c-amount">
                        {((Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0)).toLocaleString()}
                      </td>
                      <td className="c-note">
                        <input
                          type="text"
                          placeholder="비고"
                          value={ln.note}
                          title={ln.note || ''}
                          onChange={(e) => updateLine(idx, { note: e.target.value })}
                        />
                      </td>
                      <td className="c-del">
                        <button
                          type="button"
                          className="quote-cell-del"
                          onClick={() => removeLine(idx)}
                          aria-label="행 삭제"
                          title="행 삭제"
                        >
                          <Icon name="close" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline purchase-add-line quote-add-line-btn screen-only"
              onClick={addLine}
            >
              <Icon name="plus" className="btn-ic" />
              품목 추가
            </button>

            <table className="iopn-notes-table">
              <tbody>
                <tr>
                  <th className="lbl">특이사항</th>
                  <td className="val">
                    <textarea
                      className="quote-inline-textarea"
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      rows={3}
                    />
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="iopn-total-table">
              <tbody>
                <tr>
                  <th className="lbl">수 량</th>
                  <td className="num">{totalQty.toLocaleString()}</td>
                  <th className="lbl">공급가액</th>
                  <td className="num">{supplyAmount.toLocaleString()}</td>
                  <th className="lbl">VAT</th>
                  <td className="num">{vatAmount.toLocaleString()}</td>
                  <th className="lbl">합 계</th>
                  <td className="num grand">{grandTotal.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="form-actions" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '저장 중...' : isNew ? '저장' : '수정 완료'}
            </button>
            <button type="button" className="btn btn-outline" onClick={handleCancel}>
              취소
            </button>
          </div>
        </form>
      )}

      {/* 화면용 미리보기 (보기 모드) */}
      {!isEditing && quote && (
        <div className="quote-preview-wrap screen-only">
          <QuotePrintForm quote={quote} />
        </div>
      )}

      {/* 인쇄용 */}
      {printQuote && <QuotePrintForm quote={printQuote} hostClass="print-only" />}

      {/* PDF FAB — 보기 모드에서만 */}
      {!isEditing && quote && <PdfFabGroup defaultFileName={() => `견적서_${quote.supplierName || ''}`.trim()} />}
    </div>
  );
}
