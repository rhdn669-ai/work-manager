import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getQuoteById, addQuote, updateQuote } from '../../services/quoteService';
import { getSuppliers } from '../../services/purchaseService';
import { trashGeneric } from '../../services/trashService';
import { useAuth } from '../../contexts/AuthContext';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/DialogProvider';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import PdfFabGroup from '../../components/common/PdfFabGroup';
import QuotePrintForm, { DEFAULT_NOTE, SELF_INFO } from './QuotePrintForm';

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
        if (!q) { navigate('/admin/purchase/quotes', { replace: true }); return; }
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
  const vatAmount = Math.round(supplyAmount * 0.1);
  const grandTotal = supplyAmount + vatAmount;

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
    if (!form.title.trim()) { alert('제목을 입력해주세요.'); return; }
    const lines = form.items.filter((ln) => (ln.name || '').trim());
    const items = lines.map((ln) => ({
      name: ln.name, spec: ln.spec || '', unit: ln.unit || '',
      qty: Number(ln.qty) || 0, unitPrice: Number(ln.unitPrice) || 0,
      amount: (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), note: ln.note || '',
    }));
    const totalAmount = items.reduce((s, it) => s + it.amount, 0);
    const vat = Math.round(totalAmount * 0.1);
    const supplier = suppliers.find((s) => s.id === form.supplierId);
    const payload = {
      title: form.title.trim(),
      supplierId: form.supplierId,
      supplierName: supplier?.name || form.supplierName || '',
      siteName: form.siteName || '',
      items, totalAmount, vat, grandTotal: totalAmount + vat,
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
    } catch (err) {
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
    } catch (err) {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  function handleCancel() {
    if (isNew) navigate('/admin/purchase/quotes');
    else setIsEditing(false);
  }

  const printQuote = isEditing
    ? { ...form, id: quoteId || 'new', createdAt: quote?.createdAt || new Date(), totalAmount: supplyAmount, vat: vatAmount, grandTotal }
    : quote;

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="quote-detail-page printable-page">
      <style>{`
        .quote-detail-page .page-header { gap: 8px; flex-wrap: wrap; }
        .quote-detail-page .page-header h2 { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .quote-form-body { width: 100%; }
        .quote-form-body .form-group { margin-bottom: 14px; }
        .quote-line { display: grid; grid-template-columns: 2fr 2fr 0.6fr 0.7fr 1fr auto 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
        .quote-line input, .quote-line .quote-line-amount, .quote-line .purchase-line-del { min-height: 36px; box-sizing: border-box; }
        .quote-line .purchase-line-del { display: inline-flex; align-items: center; justify-content: center; }
        .quote-line-amount { text-align: right; display: inline-flex; align-items: center; justify-content: flex-end; min-width: 0; padding: 0 4px; font-variant-numeric: tabular-nums; font-size: 0.875rem; }
        @media (max-width: 768px) {
          .quote-line { grid-template-columns: 1fr 1fr 0.6fr 0.7fr 1fr auto; }
          .quote-line input[placeholder="비고"] { grid-column: 1 / -2; }
          .quote-line .purchase-line-del { grid-column: -1; }
          .quote-line-amount { grid-column: 1 / -1; text-align: right; justify-content: flex-end; }
        }
        @media (max-width: 480px) {
          .quote-line { grid-template-columns: 1fr 1fr; }
          .quote-line input[placeholder="품명"], .quote-line input[placeholder="규격"] { grid-column: 1 / -1; }
          .quote-line input[placeholder="비고"] { grid-column: 1 / -1; }
          .quote-line .purchase-line-del { grid-column: 1 / -1; }
          .quote-line-amount { grid-column: 1 / -1; }
        }
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
        <h2>{isNew ? '새 견적서' : isEditing ? '견적서 수정' : (quote?.title || '견적서')}</h2>
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

      {/* 편집 폼 */}
      {isEditing && (
        <form className="quote-form-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>제목 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예) STAGE 1SET"
              required
              autoFocus={isNew}
            />
          </div>
          <div className="form-group">
            <label>거래처</label>
            <Select
              value={form.supplierId}
              onChange={(v) => setForm({ ...form, supplierId: v })}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              ariaLabel="거래처 선택"
              placeholder="선택 (또는 아래에 직접 입력)"
            />
          </div>
          {!form.supplierId && (
            <div className="form-group">
              <label>거래처명 (직접 입력)</label>
              <input
                type="text"
                value={form.supplierName}
                onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                placeholder="등록 안된 거래처는 직접 입력"
              />
            </div>
          )}
          <div className="form-group">
            <label>현장명</label>
            <input
              type="text"
              value={form.siteName}
              onChange={(e) => setForm({ ...form, siteName: e.target.value })}
              placeholder="예) SEMES 프로버설비"
            />
          </div>
          <div className="form-group form-row-3">
            <div>
              <label>유효기간</label>
              <input type="text" value={form.validity} onChange={(e) => setForm({ ...form, validity: e.target.value })} />
            </div>
            <div>
              <label>납품기일</label>
              <input type="text" value={form.delivery} onChange={(e) => setForm({ ...form, delivery: e.target.value })} />
            </div>
            <div>
              <label>지불조건</label>
              <input type="text" value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} />
            </div>
          </div>

          <div className="form-group">
            <label>품목</label>
            <p className="field-hint">품명·규격·단위·수량·단가를 입력하세요. 합계는 자동 계산됩니다.</p>
            {form.items.map((ln, idx) => (
              <div className="quote-line" key={idx}>
                <input type="text" placeholder="품명" value={ln.name} title={ln.name || ''} onChange={(e) => updateLine(idx, { name: e.target.value })} />
                <input type="text" placeholder="규격" value={ln.spec} title={ln.spec || ''} onChange={(e) => updateLine(idx, { spec: e.target.value })} />
                <input type="text" placeholder="단위" value={ln.unit} title={ln.unit || ''} onChange={(e) => updateLine(idx, { unit: e.target.value })} />
                <input type="number" min="0" placeholder="수량" value={ln.qty || ''} style={{ textAlign: 'right' }} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                <input type="number" min="0" placeholder="단가" value={ln.unitPrice || ''} style={{ textAlign: 'right' }} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} />
                <span className="quote-line-amount">
                  {((Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0)).toLocaleString()}
                </span>
                <input type="text" placeholder="비고" value={ln.note} title={ln.note || ''} onChange={(e) => updateLine(idx, { note: e.target.value })} />
                <button type="button" className="btn btn-sm btn-outline purchase-line-del" onClick={() => removeLine(idx)} aria-label="행 삭제" title="행 삭제">
                  <Icon name="close" />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-outline purchase-add-line" onClick={addLine}>
              <Icon name="plus" className="btn-ic" />품목 추가
            </button>
          </div>

          <div className="purchase-total-row">
            <span>공급가액 / VAT (10%) / 합계</span>
            <strong>
              {supplyAmount.toLocaleString()} / {vatAmount.toLocaleString()} / {grandTotal.toLocaleString()}원
            </strong>
          </div>

          <div className="form-group">
            <label>특이사항</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} />
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
      {!isEditing && quote && (
        <PdfFabGroup defaultFileName={() => `견적서_${quote.supplierName || ''}`.trim()} />
      )}
    </div>
  );
}
