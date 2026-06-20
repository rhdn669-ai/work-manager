import { useState, useEffect, useMemo } from 'react';
import { getQuotes, addQuote, updateQuote } from '../../services/quoteService';
import { getSuppliers } from '../../services/purchaseService';
import { trashGeneric } from '../../services/trashService';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/DialogProvider';
import Icon from '../../components/common/Icon';
import { specFontClass } from '../../utils/printText';

const EMPTY_LINE = { name: '', spec: '', unit: '', qty: 0, unitPrice: 0, note: '' };
const DEFAULT_NOTE = '• 견적서 유효기간 : 15일\n• 물품 납품기간 : 일정에 준함\n• 견적서 외 사항은 별도임.';
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

const SELF_INFO = {
  companyAndCeo: '(주)아이오피엔 / 이종현',
  businessNumber: '222-81-36621',
  address: '충남 천안시 서북구 성환읍 율금1길 8-15',
  telFax: '041-415-0766 / 041-415-0767',
  email: 'iopn2024@naver.com',
  contact: '손성욱 / 010-7704-0331',
};
const PRINT_ROWS = 15;

function fmtDateKo(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function quoteNumber(quote) {
  const d = quote.createdAt?.toDate
    ? quote.createdAt.toDate()
    : quote.createdAt
      ? new Date(quote.createdAt)
      : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const idTail = (quote.id || '').slice(0, 4).toUpperCase();
  return `IOPN-Q${yyyy}${mm}${dd}-${idTail}`;
}

export default function QuotePage() {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const [previewQuote, setPreviewQuote] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const [q, s] = await Promise.all([getQuotes(), getSuppliers()]);
      setQuotes(q);
      setSuppliers(s);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return quotes;
    return quotes.filter((q) =>
      [q.title, q.supplierName, q.siteName].some((v) => (v || '').toLowerCase().includes(kw)),
    );
  }, [quotes, search]);

  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_LINE }] });
    setShowModal(true);
  }

  function openEdit(q) {
    setEditTarget(q);
    setForm({
      title: q.title || '',
      supplierId: q.supplierId || '',
      supplierName: q.supplierName || '',
      siteName: q.siteName || '',
      items: q.items && q.items.length > 0 ? q.items.map((it) => ({ ...EMPTY_LINE, ...it })) : [{ ...EMPTY_LINE }],
      validity: q.validity || '15일',
      delivery: q.delivery || '일정에 준함',
      payment: q.payment || '협의',
      note: q.note || DEFAULT_NOTE,
    });
    setShowModal(true);
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

  const supplyAmount = useMemo(
    () => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0),
    [form.items],
  );
  const vatAmount = Math.round(supplyAmount * 0.1);
  const grandTotal = supplyAmount + vatAmount;

  async function handleSubmit(e) {
    e.preventDefault();
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
      if (editTarget) {
        await updateQuote(editTarget.id, payload);
      } else {
        await addQuote(payload);
      }
      setShowModal(false);
      await loadAll();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(e, q) {
    e.stopPropagation();
    if (!(await confirm(`"${q.title}" 견적서를 삭제하시겠습니까?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      await trashGeneric(
        'quotes',
        q.id,
        {
          title: q.title,
          summary: [q.supplierName, q.siteName].filter(Boolean).join(' · '),
        },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      await loadAll();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="quote-page printable-page">
      <style>{`
        @media (max-width: 480px) {
          .quote-line { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
          .quote-line input[placeholder="품명"], .quote-line input[placeholder="규격"] { grid-column: 1 / -1; flex: 1 1 100% !important; }
          .quote-line input { flex: 1 1 calc(50% - 4px); }
          .quote-line .purchase-line-del { grid-column: 1 / -1; min-height: 36px; }
          .quote-line-amount { grid-column: 1 / -1; text-align: right; }
          .quote-page .table { font-size: 12px; }
          .quote-page .table th, .quote-page .table td { padding: 6px 8px; vertical-align: middle; }
        }
        @media (max-width: 390px) {
          .quote-page .table { font-size: 11px; }
          .quote-page .table th, .quote-page .table td { padding: 4px !important; }
          .quote-page .table td[data-label="거래처"],
          .quote-page .table td[data-label="현장"] { min-width: 80px !important; }
        }
        .quote-page .table th, .quote-page .table td { vertical-align: middle; }
        .quote-page .table tbody tr { min-height: 36px; }
        .quote-page .table tbody tr td { padding-top: 8px; padding-bottom: 8px; }
        .quote-line { display: flex; align-items: center; }
        .quote-line > * { min-height: 36px; align-items: center; }
        .quote-line input { min-height: 36px; box-sizing: border-box; }
        .quote-line .purchase-line-del { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; }
        .quote-line-amount { text-align: right; display: inline-flex; align-items: center; min-height: 36px; min-width: 80px; }
        .quote-page .table td { word-break: break-word; overflow-wrap: break-word; }
        .quote-page .table th { min-width: 80px; }
        .quote-page .table .btn { min-height: 32px; vertical-align: middle; }
        .quote-cell-clamp { min-width: 80px; max-width: 160px; }
        .quote-cell-clamp-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; white-space: normal; min-width: 0; }
        @media (max-width: 430px) { .quote-cell-clamp { max-width: 110px !important; } }
        @media (max-width: 360px) { .quote-cell-clamp { max-width: 88px !important; } }
        @media (max-width: 280px) { .quote-cell-clamp { max-width: 64px !important; } }
      `}</style>
      <div className="page-header screen-only">
        <h2>견적서 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            견적서 작성
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['quotes']}
        title="견적 휴지통"
        onChange={loadAll}
      />

      <div className="purchase-filters screen-only">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="제목 · 거래처 · 현장 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="screen-only">
        {filtered.length === 0 ? (
          <p className="purchase-empty">
            {quotes.length === 0
              ? '등록된 견적서가 없습니다. 우측 상단 "견적서 작성"으로 시작하세요.'
              : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <div className="table-scroll-x">
            <table className="table cards-sm" style={{ '--row-min-h': '36px' }}>
              <thead>
                <tr style={{ height: 36 }}>
                  <th style={{ verticalAlign: 'middle' }}>제목</th>
                  <th style={{ verticalAlign: 'middle' }}>거래처</th>
                  <th style={{ verticalAlign: 'middle' }}>현장</th>
                  <th style={{ textAlign: 'right', verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' }}>공급가액</th>
                  <th style={{ textAlign: 'right', verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' }}>합계</th>
                  <th style={{ verticalAlign: 'middle' }}>작성일</th>
                  <th className="bom-project-action-col" style={{ verticalAlign: 'middle' }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id} className="table-clickable-row" style={{ minHeight: 36 }} onClick={() => setPreviewQuote(q)}>
                    <td data-label="제목" title={q.title || ''}>
                      <strong>{q.title}</strong>
                    </td>
                    <td data-label="거래처" title={q.supplierName || ''} className="quote-cell-clamp">
                      <span className="quote-cell-clamp-text" title={q.supplierName || ''}>{q.supplierName || '-'}</span>
                    </td>
                    <td data-label="현장" title={q.siteName || ''} className="quote-cell-clamp">
                      <span className="quote-cell-clamp-text" title={q.siteName || ''}>{q.siteName || '-'}</span>
                    </td>
                    <td data-label="공급가액" style={{ textAlign: 'right', verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(q.totalAmount || 0).toLocaleString()}원
                    </td>
                    <td data-label="합계" style={{ textAlign: 'right', verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{Number(q.grandTotal || 0).toLocaleString()}원</strong>
                    </td>
                    <td data-label="작성일" style={{ verticalAlign: 'middle' }}>{fmtDateKo(q.createdAt)}</td>
                    <td className="bom-project-action-col action-cell" style={{ verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-sm btn-danger" onClick={(e) => handleDelete(e, q)}>
                        <Icon name="trash" className="btn-ic" />삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 견적서 작성/수정 모달 */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? '견적서 수정' : '견적서 작성'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>제목 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예) STAGE 1SET"
              required
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
              <input
                type="text"
                value={form.validity}
                onChange={(e) => setForm({ ...form, validity: e.target.value })}
              />
            </div>
            <div>
              <label>납품기일</label>
              <input
                type="text"
                value={form.delivery}
                onChange={(e) => setForm({ ...form, delivery: e.target.value })}
              />
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
              <div className="quote-line" key={idx} style={{ flexWrap: 'wrap', gap: 6 }}>
                <input
                  type="text"
                  placeholder="품명"
                  value={ln.name}
                  title={ln.name || ''}
                  onChange={(e) => updateLine(idx, { name: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="규격"
                  value={ln.spec}
                  title={ln.spec || ''}
                  onChange={(e) => updateLine(idx, { spec: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="단위"
                  value={ln.unit}
                  title={ln.unit || ''}
                  onChange={(e) => updateLine(idx, { unit: e.target.value })}
                />
                <input
                  className="num-input"
                  type="number"
                  min="0"
                  placeholder="수량"
                  value={ln.qty || ''}
                  onChange={(e) => updateLine(idx, { qty: e.target.value })}
                />
                <input
                  className="num-input"
                  type="number"
                  min="0"
                  placeholder="단가"
                  value={ln.unitPrice || ''}
                  onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                />
                <span className="quote-line-amount">
                  {((Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0)).toLocaleString()}
                </span>
                <input
                  type="text"
                  placeholder="비고"
                  value={ln.note}
                  title={ln.note || ''}
                  onChange={(e) => updateLine(idx, { note: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline purchase-line-del"
                  onClick={() => removeLine(idx)}
                  aria-label="행 삭제"
                  title="행 삭제"
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-outline purchase-add-line" onClick={addLine}>
              <Icon name="plus" className="btn-ic" />
              품목 추가
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

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">
              {editTarget ? '수정' : '저장'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
              취소
            </button>
          </div>
        </form>
      </Modal>

      {/* 미리보기 모달 (화면용) */}
      {previewQuote && (
        <Modal isOpen={!!previewQuote} onClose={() => setPreviewQuote(null)} title="견적서 미리보기">
          <div className="quote-preview-wrap screen-only">
            <QuotePrintForm quote={previewQuote} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>
              PDF 출력
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                openEdit(previewQuote);
                setPreviewQuote(null);
              }}
            >
              수정
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setPreviewQuote(null)}>
              닫기
            </button>
          </div>
        </Modal>
      )}

      {/* 인쇄용 — 선택된 견적서 양식 */}
      {previewQuote && <QuotePrintForm quote={previewQuote} hostClass="print-only" />}

      {/* PDF 출력 floating 버튼 — 선택된 견적서가 있을 때만 */}
      {previewQuote && (
        <button
          type="button"
          className="pdf-print-fab no-print"
          onClick={() => window.print()}
          title="PDF로 저장하려면 인쇄 다이얼로그에서 'PDF로 저장'을 선택하세요"
        >
          PDF 출력
        </button>
      )}
    </div>
  );
}

function QuotePrintForm({ quote, hostClass }) {
  const supplyAmount =
    Number(quote.totalAmount) ||
    (quote.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const vat = Number(quote.vat) || Math.round(supplyAmount * 0.1);
  const grandTotal = Number(quote.grandTotal) || supplyAmount + vat;
  const totalQty = (quote.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const printRows = [...(quote.items || [])];
  while (printRows.length < PRINT_ROWS) printRows.push(null);
  const supplierTitle = quote.supplierName ? `${quote.supplierName} 귀하` : '';
  return (
    <div className={`print-form-iopn ${hostClass || ''}`}>
      <div className="print-form-title">견 적 서</div>
      <table className="iopn-info-table">
        <tbody>
          <tr>
            <th className="lbl">수 신</th>
            <td className="val">{supplierTitle}</td>
            <th className="lbl">사업자등록번호</th>
            <td className="val">{SELF_INFO.businessNumber}</td>
          </tr>
          <tr>
            <th className="lbl">현 장 명</th>
            <td className="val">{quote.siteName || ''}</td>
            <th className="lbl">회사명/대표</th>
            <td className="val">{SELF_INFO.companyAndCeo}</td>
          </tr>
          <tr>
            <th className="lbl">발행번호</th>
            <td className="val">{quoteNumber(quote)}</td>
            <th className="lbl">주 소</th>
            <td className="val">{SELF_INFO.address}</td>
          </tr>
          <tr>
            <th className="lbl">유효기간</th>
            <td className="val">{quote.validity || '15일'}</td>
            <th className="lbl">TEL/FAX</th>
            <td className="val">{SELF_INFO.telFax}</td>
          </tr>
          <tr>
            <th className="lbl">납품기일</th>
            <td className="val">{quote.delivery || '일정에 준함'}</td>
            <th className="lbl">E-Mail</th>
            <td className="val">{SELF_INFO.email}</td>
          </tr>
          <tr>
            <th className="lbl">지불조건</th>
            <td className="val">{quote.payment || '협의'}</td>
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

      <table className="iopn-items-table">
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
          </tr>
        </thead>
        <tbody>
          {printRows.map((ln, idx) => {
            if (!ln)
              return (
                <tr key={`empty-${idx}`}>
                  <td className="c-no">{idx + 1}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              );
            const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
            return (
              <tr key={idx}>
                <td className="c-no">{idx + 1}</td>
                <td className={`c-name ${specFontClass(ln.name, 18)}`} title={ln.name || ''}>{ln.name || ''}</td>
                <td className={`c-spec ${specFontClass(ln.spec, 20)}`} title={ln.spec || ''}>{ln.spec || ''}</td>
                <td className="c-unit">{ln.unit || ''}</td>
                <td className="c-qty">{Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}</td>
                <td className="c-price">{Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}</td>
                <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                <td className={`c-note ${specFontClass(ln.note, 12)}`} title={ln.note || ''}>{ln.note || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="iopn-notes-table">
        <tbody>
          <tr>
            <th className="lbl">특이사항</th>
            <td className="val">{quote.note || DEFAULT_NOTE}</td>
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
            <td className="num">{vat.toLocaleString()}</td>
            <th className="lbl">합 계</th>
            <td className="num grand">{grandTotal.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <div className="iopn-form-footer">
        <span>(주)아이오피엔 · 견적서 · {quoteNumber(quote)}</span>
        <span>{SELF_INFO.contact}</span>
      </div>
    </div>
  );
}
