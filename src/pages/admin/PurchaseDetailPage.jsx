import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getPurchaseById, updatePurchase, deletePurchase,
  settlePurchase, cancelSettlePurchase, receivePurchaseLine, bulkReceivePurchase,
  getSuppliers, getPurchaseItems, addPurchaseItem, nextItemCode,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from '../../components/common/DialogProvider';
import Modal from '../../components/common/Modal';

const STATUS = {
  ordered: { label: '발주', cls: 'ordered' },
  partial: { label: '부분입고', cls: 'partial' },
  received: { label: '입고완료', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
};

const EMPTY_LINE = { itemId: '', name: '', spec: '', unit: '', qty: 1, unitPrice: 0 };

// 자사 정보 (IOPN_v4 양식 기준 — 발주서 PDF 상단 자사 박스에 표시)
const SELF_INFO = {
  companyAndCeo: '(주)아이오피엔 / 이종현',
  businessNumber: '222-81-36621',
  address: '충남 천안시 서북구 성환읍 율금1길 8-15',
  telFax: '041-415-0766 / 041-415-0767',
  email: 'iopn2024@naver.com',
  contact: '손성욱 / 010-7704-0331',
};
const PO_DEFAULTS = {
  validity: '협의',
  payment: '납품완료후 익월말',
  delivery: '긴급',
};
const PRINT_ROWS = 15; // 양식 표 빈 행 포함 총 행수 (A4 세로 한 페이지 기준)
function poNumber(purchase) {
  const d = purchase.orderedAt?.toDate ? purchase.orderedAt.toDate() : (purchase.orderedAt ? new Date(purchase.orderedAt) : new Date(purchase.createdAt?.toDate ? purchase.createdAt.toDate() : new Date()));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `IOPN${yyyy}${mm}${dd}`;
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 첫 품목의 defaultSupplierId 자동 추출 — 모두 같은 구매처면 그 값, 혼합/없음이면 빈값
function deriveSupplier(lines, itemMaster, suppliers) {
  const ids = lines
    .map((ln) => {
      const m = itemMaster.find((x) => x.id === ln.itemId);
      return m?.defaultSupplierId || '';
    })
    .filter(Boolean);
  if (ids.length === 0) return { supplierId: '', supplierName: '' };
  const unique = [...new Set(ids)];
  if (unique.length === 1) {
    const sup = suppliers.find((s) => s.id === unique[0]);
    return { supplierId: unique[0], supplierName: sup?.name || '' };
  }
  return { supplierId: '', supplierName: '' };
}

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { confirm, alert } = useDialog();

  const [purchase, setPurchase] = useState(null);
  const [sites, setSites] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeLine, setActiveLine] = useState(null);

  // 편집 가능한 폼 상태 (자동 저장 X, 명시 저장 버튼 사용)
  const [form, setForm] = useState({
    title: '', siteId: '', items: [{ ...EMPTY_LINE }], note: '',
  });
  const [dirty, setDirty] = useState(false);

  const [receiveModal, setReceiveModal] = useState(null); // { lineIdx, line } | null
  const [receiveForm, setReceiveForm] = useState({ qty: '', date: todayStr(), note: '' });
  const [bulkModal, setBulkModal] = useState(null); // { mode: 'remaining' | 'close-as-is' } | null
  const [bulkForm, setBulkForm] = useState({ date: todayStr(), note: '' });

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadData() {
    try {
      setLoading(true);
      const [p, st, sp, im] = await Promise.all([
        getPurchaseById(id), getAllSites(), getSuppliers(), getPurchaseItems(),
      ]);
      if (!p) {
        alert('해당 구매 건을 찾을 수 없습니다.');
        navigate('/admin/purchase');
        return;
      }
      setPurchase(p);
      setSites(st);
      setSuppliers(sp);
      setItemMaster(im);
      setForm({
        title: p.title || '',
        siteId: p.siteId || '',
        items: (p.items && p.items.length > 0)
          ? p.items.map((it) => ({ ...EMPTY_LINE, ...it }))
          : [{ ...EMPTY_LINE }],
        note: p.note || '',
      });
      setDirty(false);
    } catch (err) {
      console.error(err);
      alert('불러오기 오류: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function patchForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  }

  function updateLine(idx, patch) {
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)),
    }));
    setDirty(true);
  }

  function pickItemForLine(idx, m) {
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => {
        if (i !== idx) return ln;
        return {
          ...ln,
          itemId: m.id,
          name: m.name,
          spec: m.spec || ln.spec,
          unit: m.unit || ln.unit,
          unitPrice: Number(ln.unitPrice) > 0 ? ln.unitPrice : (Number(m.standardPrice) || 0),
        };
      }),
    }));
    setActiveLine(null);
    setDirty(true);
  }

  function updateLineName(idx, name) {
    const trimmed = name;
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => {
        if (i !== idx) return ln;
        const m = itemMaster.find((x) => x.name === trimmed);
        if (m) {
          return {
            ...ln,
            itemId: m.id,
            name: m.name,
            spec: m.spec || ln.spec,
            unit: m.unit || ln.unit,
            unitPrice: Number(ln.unitPrice) > 0 ? ln.unitPrice : (Number(m.standardPrice) || 0),
          };
        }
        return { ...ln, itemId: '', name: trimmed };
      }),
    }));
    setDirty(true);
  }

  function addLine() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_LINE }] }));
    setDirty(true);
  }

  function removeLine(idx) {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }));
    setDirty(true);
  }

  const formTotal = useMemo(
    () => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0),
    [form.items],
  );

  const isReadOnly = purchase?.status === 'settled';

  async function handleSave() {
    if (!form.title.trim()) { alert('제목을 입력해주세요.'); return; }
    if (!form.siteId) { alert('프로젝트를 선택해주세요.'); return; }

    const lines = form.items.filter((ln) => (ln.name || '').trim());

    // 마스터에 없는 품목은 자동 생성
    const linesWithIds = [];
    let masterBuf = [...itemMaster];
    for (const ln of lines) {
      let itemId = ln.itemId;
      if (!itemId) {
        const m = masterBuf.find((x) => x.name === ln.name.trim());
        if (m) itemId = m.id;
      }
      if (!itemId) {
        const code = nextItemCode(masterBuf, ln.name.trim());
        const docRef = await addPurchaseItem({
          code,
          name: ln.name.trim(),
          spec: ln.spec || '',
          unit: ln.unit || '',
          standardPrice: Number(ln.unitPrice) || 0,
          priceHistory: [],
        });
        itemId = docRef.id;
        masterBuf = [...masterBuf, { id: itemId, code, name: ln.name.trim() }];
      }
      linesWithIds.push({ ...ln, itemId });
    }

    const items = linesWithIds.map((ln) => ({
      itemId: ln.itemId, name: ln.name, spec: ln.spec, unit: ln.unit,
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      amount: (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0),
    }));
    const totalAmount = items.reduce((s, it) => s + it.amount, 0);
    const site = sites.find((s) => s.id === form.siteId);
    const { supplierId, supplierName } = deriveSupplier(items, masterBuf, suppliers);

    try {
      await updatePurchase(id, {
        title: form.title.trim(),
        siteId: form.siteId,
        siteName: site?.name || '',
        items,
        totalAmount,
        supplierId,
        supplierName,
        note: form.note,
      });
      await loadData();
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  }

  function openReceive(lineIdx) {
    if (dirty) {
      alert('먼저 변경 사항을 저장한 후 입고 처리를 진행해 주세요.');
      return;
    }
    const line = purchase.items?.[lineIdx];
    if (!line) return;
    const remaining = Math.max(0, (Number(line.qty) || 0) - (Number(line.receivedQty) || 0));
    setReceiveForm({
      qty: remaining > 0 ? String(remaining) : String(Number(line.qty) || 0),
      date: line.receivedAt ? fmtDate(line.receivedAt) : todayStr(),
      note: line.receiveNote || '',
    });
    setReceiveModal({ lineIdx, line });
  }

  async function submitReceive(e) {
    e.preventDefault();
    if (!receiveModal) return;
    try {
      await receivePurchaseLine(purchase, receiveModal.lineIdx, {
        qty: receiveForm.qty,
        date: receiveForm.date,
        note: receiveForm.note,
        receivedBy: userProfile?.name || '',
      });
      setReceiveModal(null);
      await loadData();
    } catch (err) {
      alert('입고 처리 중 오류: ' + err.message);
    }
  }

  function openBulk(mode) {
    if (dirty) {
      alert('먼저 변경 사항을 저장해 주세요.');
      return;
    }
    setBulkForm({ date: todayStr(), note: '' });
    setBulkModal({ mode });
  }

  async function submitBulk(e) {
    e.preventDefault();
    if (!bulkModal) return;
    const mode = bulkModal.mode;
    const remainingCount = (purchase.items || []).filter((it) => {
      const r = Number(it.receivedQty) || 0;
      const q = Number(it.qty) || 0;
      return q > 0 && r < q;
    }).length;
    if (mode === 'remaining' && remainingCount === 0) {
      alert('잔여 입고할 라인이 없습니다.');
      return;
    }
    const msg = mode === 'close-as-is'
      ? '현재 입고된 수량으로 발주 수량을 정정하고 입고를 종결합니다.\n미입고 라인은 수량 0으로 처리됩니다. 계속할까요?'
      : `잔여 ${remainingCount}개 라인을 동일 입고일로 일괄 입고 처리하시겠습니까?`;
    if (!await confirm(msg)) return;
    try {
      await bulkReceivePurchase(purchase, {
        mode,
        date: bulkForm.date,
        note: bulkForm.note,
        receivedBy: userProfile?.name || '',
      });
      setBulkModal(null);
      await loadData();
    } catch (err) {
      alert('일괄 입고 처리 중 오류: ' + err.message);
    }
  }

  async function clearLineReceive(lineIdx) {
    if (dirty) {
      alert('먼저 변경 사항을 저장해 주세요.');
      return;
    }
    if (!await confirm('이 라인의 입고 기록을 취소하시겠습니까?')) return;
    try {
      await receivePurchaseLine(purchase, lineIdx, {
        qty: 0, date: null, note: '', receivedBy: '',
      });
      await loadData();
    } catch (err) {
      alert('입고 취소 중 오류: ' + err.message);
    }
  }

  async function handleSettle() {
    if (!purchase) return;
    const where = purchase.siteName || '귀속 프로젝트';
    if (!await confirm(
      `"${purchase.title}" 건을 정산하시겠습니까?\n금액 ${Number(purchase.totalAmount || 0).toLocaleString()}원이 ${where} 지출로 자동 등록됩니다.`,
    )) return;
    try {
      await settlePurchase(purchase, userProfile?.name || '');
      await loadData();
    } catch (err) {
      alert('정산 중 오류: ' + err.message);
    }
  }

  async function handleCancelSettle() {
    if (!purchase) return;
    if (!await confirm(
      `"${purchase.title}" 정산을 취소하시겠습니까?\n등록된 지출 항목이 삭제되고, 품목 단가 이력에서도 이 구매 기록이 제거됩니다.\n구매 상태는 '입고'로 되돌아갑니다.`,
    )) return;
    try {
      await cancelSettlePurchase(purchase);
      await loadData();
    } catch (err) {
      alert('정산 취소 중 오류: ' + err.message);
    }
  }

  async function handleDelete() {
    if (!purchase) return;
    if (!await confirm(`"${purchase.title}" 구매 건을 삭제하시겠습니까?`)) return;
    try {
      await deletePurchase(id);
      navigate('/admin/purchase');
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading || !purchase) return <div className="loading">로딩 중...</div>;

  const status = purchase.status || 'ordered';
  const derivedSupplier = purchase.supplierName || (() => {
    const { supplierName } = deriveSupplier(form.items, itemMaster, suppliers);
    return supplierName;
  })();

  return (
    <div className="purchase-detail-page printable-page">
      <div className="page-header screen-only">
        <div className="purchase-detail-header-left">
          <Link to="/admin/purchase" className="purchase-back-link">← 목록</Link>
          <h2>{purchase.title || '(제목 없음)'}</h2>
          <span className={`purchase-badge purchase-badge-${STATUS[status]?.cls || 'ordered'}`}>
            {STATUS[status]?.label || status}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="pdf-print-fab no-print"
        onClick={() => window.print()}
        title="PDF로 저장하려면 인쇄 다이얼로그에서 'PDF로 저장'을 선택하세요"
      >
        PDF 출력
      </button>

      {/* 인쇄 전용 IOPN_v4 발주서 양식 */}
      {(() => {
        const supplier = suppliers.find((s) => s.id === purchase.supplierId);
        const site = sites.find((s) => s.id === purchase.siteId);
        const supplyAmount = form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0);
        const totalQty = form.items.reduce((s, ln) => s + (Number(ln.qty) || 0), 0);
        const vat = Math.round(supplyAmount * 0.1);
        const grandTotal = supplyAmount + vat;
        const orderDate = purchase.orderedAt?.toDate ? purchase.orderedAt.toDate()
          : (purchase.orderedAt ? new Date(purchase.orderedAt)
            : (purchase.createdAt?.toDate ? purchase.createdAt.toDate() : new Date()));
        const orderDateKo = `${orderDate.getFullYear()}년 ${orderDate.getMonth() + 1}월 ${orderDate.getDate()}일`;
        const rows = [...form.items];
        while (rows.length < PRINT_ROWS) rows.push(null);
        const supplierTitle = supplier?.name ? `${supplier.name} 귀하` : (derivedSupplier ? `${derivedSupplier} 귀하` : '');
        return (
          <div className="print-form-iopn print-only">
            <div className="print-form-title">구 매 발 주 서</div>

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
                  <td className="val">{site?.name || purchase.siteName || ''}</td>
                  <th className="lbl">회사명/대표</th>
                  <td className="val">{SELF_INFO.companyAndCeo}</td>
                </tr>
                <tr>
                  <th className="lbl">납품장소</th>
                  <td className="val">{purchase.deliveryPlace || SELF_INFO.address}</td>
                  <th className="lbl">주 소</th>
                  <td className="val">{SELF_INFO.address}</td>
                </tr>
                <tr>
                  <th className="lbl">발행번호</th>
                  <td className="val">{poNumber(purchase)}</td>
                  <th className="lbl">TEL/FAX</th>
                  <td className="val">{SELF_INFO.telFax}</td>
                </tr>
                <tr>
                  <th className="lbl">발 주 일</th>
                  <td className="val">{orderDateKo}</td>
                  <th className="lbl">납품기일</th>
                  <td className="val">{purchase.deliveryDue || PO_DEFAULTS.delivery}</td>
                </tr>
                <tr>
                  <th className="lbl">지불조건</th>
                  <td className="val">{purchase.payment || PO_DEFAULTS.payment}</td>
                  <th className="lbl">담당/연락처</th>
                  <td className="val">{purchase.requesterName || ''}</td>
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
                {rows.map((ln, idx) => {
                  if (!ln) return (
                    <tr key={`empty-${idx}`}>
                      <td className="c-no">{idx + 1}</td>
                      <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                    </tr>
                  );
                  const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                  return (
                    <tr key={idx}>
                      <td className="c-no">{idx + 1}</td>
                      <td className="c-name">{ln.name || ''}</td>
                      <td className="c-spec">{ln.spec || ''}</td>
                      <td className="c-unit">{ln.unit || ''}</td>
                      <td className="c-qty">{Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}</td>
                      <td className="c-price">{Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}</td>
                      <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                      <td className="c-note">{ln.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <table className="iopn-notes-table">
              <tbody>
                <tr>
                  <th className="lbl">특이사항</th>
                  <td className="val">{form.note || ''}</td>
                </tr>
              </tbody>
            </table>

            <table className="iopn-total-table">
              <tbody>
                <tr>
                  <th className="lbl">수량</th>
                  <td className="num">{totalQty.toLocaleString()}</td>
                  <th className="lbl">공급가액</th>
                  <td className="num">{supplyAmount.toLocaleString()}</td>
                  <th className="lbl">VAT</th>
                  <td className="num">{vat.toLocaleString()}</td>
                  <th className="lbl">합계</th>
                  <td className="num grand">{grandTotal.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      <div className="purchase-meta-bar screen-only">
        <div className="purchase-meta-items">
          <span><em>프로젝트</em>{purchase.siteName || '-'}</span>
          <span><em>등록자</em>{purchase.requesterName || '-'}</span>
          <span><em>발주일</em>{fmtDate(purchase.orderedAt || purchase.createdAt)}</span>
          <span><em>구매처</em>{derivedSupplier || <span className="text-muted">자동 (품목 미선택)</span>}</span>
          {purchase.receivedBy && (
            <span><em>입고</em>{purchase.receivedBy} · {fmtDate(purchase.receivedAt)}</span>
          )}
          {purchase.settledBy && (
            <span><em>정산</em>{purchase.settledBy} · {fmtDate(purchase.settledAt)}</span>
          )}
        </div>
      </div>

      <div className="form-group screen-only">
        <label>품목</label>
        <p className="field-hint">품명 칸에서 검색해 선택하면 코드·메이커·규격·분류·인증·moq/단위가 자동 채워집니다. 없는 품목은 품명을 직접 입력하면 저장 시 자동 등록됩니다. 구매처는 첫 품목의 기본 구매처로 자동 적용.</p>
        <div className="item-group is-expanded bom-flat-group">
          <div className="item-group-detail">
            <table className="table inline-edit-table cards-sm bom-flat-table">
              <thead>
                <tr>
                  <th className="bom-spacer-col" aria-hidden="true"></th>
                  <th style={{ minWidth: 100 }}>코드</th>
                  <th style={{ minWidth: 160 }}>품명</th>
                  <th>메이커</th>
                  <th>규격</th>
                  <th>분류</th>
                  <th>인증</th>
                  <th>moq/단위</th>
                  <th>수량</th>
                  <th>단가</th>
                  <th>합계</th>
                  <th style={{ minWidth: 160 }}>비고</th>
                  <th style={{ minWidth: 160 }} className="no-print">입고</th>
                  <th className="bom-action-col no-print" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.length === 0 && (
                  <tr>
                    <td colSpan={14} className="text-muted text-sm" style={{ textAlign: 'center', padding: 16 }}>
                      품목이 없습니다 — 아래 "+ 품목 추가"로 시작하세요.
                    </td>
                  </tr>
                )}
                {form.items.map((ln, idx) => {
                  const kw = (ln.name || '').toLowerCase().trim();
                  const matches = itemMaster.filter((m) => {
                    if (!kw) return true;
                    return (m.code || '').toLowerCase().includes(kw)
                        || (m.name || '').toLowerCase().includes(kw)
                        || (m.spec || '').toLowerCase().includes(kw);
                  }).slice(0, 50);
                  const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
                  const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                  const savedLine = purchase.items?.[idx];
                  const savedQty = Number(savedLine?.qty) || 0;
                  const receivedQty = Number(savedLine?.receivedQty) || 0;
                  const isLineSaved = !!savedLine && !dirty;
                  const isFullyReceived = isLineSaved && savedQty > 0 && receivedQty >= savedQty;
                  const isPartial = isLineSaved && receivedQty > 0 && receivedQty < savedQty;
                  return (
                    <tr key={idx}>
                      <td className="bom-spacer-col" aria-hidden="true"></td>
                      <td data-label="코드">
                        <input
                          type="text"
                          className="bom-readonly-input bom-code-input"
                          value={master?.code || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="품명">
                        <div className="purchase-line-item-wrap">
                          <input
                            className="purchase-line-item"
                            type="text"
                            placeholder="품목명 검색·입력"
                            value={ln.name}
                            onChange={(e) => updateLineName(idx, e.target.value)}
                            onFocus={() => setActiveLine(idx)}
                            onBlur={() => setTimeout(() => setActiveLine((c) => (c === idx ? null : c)), 150)}
                            autoComplete="off"
                            disabled={isReadOnly}
                          />
                          {activeLine === idx && !isReadOnly && (
                            <div className="purchase-line-dropdown">
                              {matches.length === 0 ? (
                                <div className="purchase-line-option-empty">
                                  {kw ? `"${kw}"는 새 품목으로 등록됩니다` : '등록된 품목이 없습니다 — 직접 입력하세요'}
                                </div>
                              ) : (
                                matches.map((m) => (
                                  <button
                                    type="button"
                                    key={m.id}
                                    className={`purchase-line-option ${m.id === ln.itemId ? 'is-selected' : ''}`}
                                    onMouseDown={(e) => { e.preventDefault(); pickItemForLine(idx, m); }}
                                  >
                                    <span className="opt-name">
                                      {m.code && <span className="opt-code">[{m.code}]</span>}
                                      {m.name}{m.spec ? ` (${m.spec})` : ''}
                                    </span>
                                    {m.standardPrice > 0 && (
                                      <span className="opt-price">{Number(m.standardPrice).toLocaleString()}원</span>
                                    )}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-label="메이커">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.maker || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="규격">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.spec || ln.spec || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="분류">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.category || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="인증">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.certification || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="moq/단위">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.unit || ln.unit || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="수량">
                        <input
                          className="num-input"
                          type="number" min="0"
                          value={ln.qty}
                          onChange={(e) => updateLine(idx, { qty: e.target.value })}
                          disabled={isReadOnly}
                        />
                      </td>
                      <td data-label="단가">
                        <input
                          className="num-input"
                          type="number" min="0"
                          value={ln.unitPrice}
                          onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                          disabled={isReadOnly}
                        />
                      </td>
                      <td data-label="합계">
                        <input
                          type="text"
                          className="bom-readonly-input bom-amount-input"
                          value={amount ? amount.toLocaleString() : ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="비고">
                        <input
                          type="text"
                          value={ln.note || ''}
                          placeholder="-"
                          onChange={(e) => updateLine(idx, { note: e.target.value })}
                          disabled={isReadOnly}
                        />
                      </td>
                      <td data-label="입고" className="no-print">
                        <div className="purchase-line-recv">
                          {!isLineSaved ? (
                            <span className="purchase-line-recv-hint">저장 후 입고</span>
                          ) : isFullyReceived ? (
                            <button
                              type="button"
                              className={`purchase-recv-chip is-full ${isReadOnly ? 'is-readonly' : ''}`}
                              onClick={() => !isReadOnly && openReceive(idx)}
                              title={isReadOnly ? '정산 완료' : '입고 수정'}
                              disabled={isReadOnly}
                            >
                              <span className="purchase-recv-chip-qty">완료 {receivedQty}/{savedQty}</span>
                              <span className="purchase-recv-chip-date">{fmtDate(savedLine.receivedAt)}</span>
                            </button>
                          ) : isPartial ? (
                            <button
                              type="button"
                              className={`purchase-recv-chip is-partial ${isReadOnly ? 'is-readonly' : ''}`}
                              onClick={() => !isReadOnly && openReceive(idx)}
                              title={isReadOnly ? '정산 완료' : '입고 추가/수정'}
                              disabled={isReadOnly}
                            >
                              <span className="purchase-recv-chip-qty">부분 {receivedQty}/{savedQty}</span>
                              <span className="purchase-recv-chip-date">{fmtDate(savedLine.receivedAt)}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline purchase-recv-btn"
                              onClick={() => openReceive(idx)}
                              disabled={isReadOnly || savedQty <= 0}
                              title={savedQty <= 0 ? '수량을 먼저 입력하세요' : ''}
                            >
                              입고
                            </button>
                          )}
                          {isLineSaved && receivedQty > 0 && !isReadOnly && (
                            <button
                              type="button"
                              className="purchase-recv-clear"
                              onClick={() => clearLineReceive(idx)}
                              aria-label="입고 취소"
                              title="입고 기록 취소"
                            >↺</button>
                          )}
                        </div>
                      </td>
                      <td className="bom-action-col no-print">
                        <button
                          type="button"
                          className="closing-delete"
                          onClick={() => removeLine(idx)}
                          aria-label="행 삭제"
                          disabled={isReadOnly}
                          title="삭제"
                        >✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {!isReadOnly && (
          <button type="button" className="btn btn-sm btn-outline purchase-add-line no-print" onClick={addLine}>
            + 품목 추가
          </button>
        )}
      </div>

      <div className="purchase-total-row screen-only">
        <span>합계</span>
        <strong>{formTotal.toLocaleString()}원</strong>
      </div>


      <div className="form-group screen-only">
        <label>메모</label>
        <textarea
          value={form.note}
          onChange={(e) => patchForm({ note: e.target.value })}
          rows={2}
          disabled={isReadOnly}
        />
      </div>

      {purchase.receiveNote && (
        <div className="form-group screen-only">
          <label>검수 메모</label>
          <p className="purchase-readonly-text">{purchase.receiveNote}</p>
        </div>
      )}

      <div className="purchase-detail-actions no-print">
        {!isReadOnly && (
          <button
            type="button"
            className={`btn ${dirty ? 'btn-primary' : 'btn-outline'}`}
            onClick={handleSave}
            disabled={!dirty}
          >
            {dirty ? '저장' : '저장됨'}
          </button>
        )}
        {(status === 'ordered' || status === 'partial') && (() => {
          const remainingCount = (purchase.items || []).filter((it) => {
            const r = Number(it.receivedQty) || 0;
            const q = Number(it.qty) || 0;
            return q > 0 && r < q;
          }).length;
          const hasAnyReceived = (purchase.items || []).some((it) => Number(it.receivedQty) > 0);
          return (
            <>
              <span className="purchase-status-hint">
                {status === 'partial'
                  ? `부분 입고 진행 중 — 잔여 ${remainingCount}개 라인. 일괄 처리하거나 잔여 무시하고 종결할 수 있습니다`
                  : '품목별로 입고 처리하거나 일괄 입고로 전체 완료 처리하세요'}
              </span>
              {remainingCount > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openBulk('remaining')}
                  disabled={dirty}
                  title={dirty ? '먼저 저장하세요' : '잔여 라인 일괄 입고'}
                >일괄 입고</button>
              )}
              {status === 'partial' && hasAnyReceived && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => openBulk('close-as-is')}
                  disabled={dirty}
                  title="현재 입고된 수량으로 발주 수량을 정정하고 종결"
                >잔여 무시하고 종결</button>
              )}
              <button type="button" className="btn btn-danger" onClick={handleDelete}>삭제</button>
            </>
          );
        })()}
        {status === 'received' && (
          <>
            <button type="button" className="btn btn-primary" onClick={handleSettle} disabled={dirty} title={dirty ? '먼저 저장하세요' : ''}>정산 처리</button>
            <button type="button" className="btn btn-danger" onClick={handleDelete}>삭제</button>
          </>
        )}
        {status === 'settled' && (
          <>
            <span className="purchase-settled-note">
              정산 완료 — {purchase.siteName || '귀속 프로젝트'} 지출에 반영됨
            </span>
            <button type="button" className="btn btn-danger" onClick={handleCancelSettle}>정산 취소</button>
          </>
        )}
      </div>

      <Modal
        isOpen={!!bulkModal}
        onClose={() => setBulkModal(null)}
        title={bulkModal?.mode === 'close-as-is' ? '잔여 무시하고 입고 종결' : '일괄 입고 처리'}
      >
        {bulkModal && (() => {
          const isClose = bulkModal.mode === 'close-as-is';
          const lines = purchase.items || [];
          const affected = isClose
            ? lines.filter((it) => (Number(it.receivedQty) || 0) > 0)
            : lines.filter((it) => {
              const r = Number(it.receivedQty) || 0;
              const q = Number(it.qty) || 0;
              return q > 0 && r < q;
            });
          return (
            <form onSubmit={submitBulk}>
              <div className="purchase-recv-modal-summary">
                <strong className="purchase-recv-modal-name">
                  {isClose ? '현재 입고된 수량으로 종결' : `잔여 ${affected.length}개 라인 일괄 입고`}
                </strong>
                <span className="purchase-recv-modal-meta">
                  {isClose
                    ? `미입고 라인은 수량 0으로 정리됩니다. 발주 금액이 입고 기준으로 재계산됩니다.`
                    : `각 라인의 잔여 수량만큼 동일한 입고일로 받습니다.`}
                </span>
              </div>

              {!isClose && (
                <>
                  <div className="form-group">
                    <label>입고일 *</label>
                    <input
                      type="date"
                      value={bulkForm.date}
                      onChange={(e) => setBulkForm({ ...bulkForm, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>검수 메모</label>
                    <textarea
                      value={bulkForm.note}
                      onChange={(e) => setBulkForm({ ...bulkForm, note: e.target.value })}
                      rows={2}
                      placeholder="수량 확인 · 하자 여부 등"
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>{isClose ? '종결 대상 라인' : '대상 라인'}</label>
                <ul className="purchase-recv-bulk-list">
                  {affected.length === 0 ? (
                    <li className="purchase-recv-bulk-empty">대상 라인이 없습니다.</li>
                  ) : (
                    affected.map((it, i) => {
                      const r = Number(it.receivedQty) || 0;
                      const q = Number(it.qty) || 0;
                      return (
                        <li key={i}>
                          <span className="purchase-recv-bulk-name">{it.name || '(이름 없음)'}{it.spec ? ` (${it.spec})` : ''}</span>
                          <span className="purchase-recv-bulk-qty">
                            {isClose ? `${r}${it.unit || ''} 종결` : `${r}/${q}${it.unit || ''} → ${q}${it.unit || ''}`}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div className="modal-actions">
                <button type="submit" className={`btn ${isClose ? 'btn-danger' : 'btn-primary'}`}>
                  {isClose ? '종결 처리' : '일괄 입고'}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setBulkModal(null)}>취소</button>
              </div>
            </form>
          );
        })()}
      </Modal>

      <Modal
        isOpen={!!receiveModal}
        onClose={() => setReceiveModal(null)}
        title="입고 검수"
      >
        {receiveModal && (
          <form onSubmit={submitReceive}>
            <div className="purchase-recv-modal-summary">
              <strong className="purchase-recv-modal-name">
                {receiveModal.line.name}
                {receiveModal.line.spec ? ` (${receiveModal.line.spec})` : ''}
              </strong>
              <span className="purchase-recv-modal-meta">
                발주 {Number(receiveModal.line.qty) || 0}{receiveModal.line.unit || ''}
                {Number(receiveModal.line.receivedQty) > 0 && (
                  <> · 이전 입고 {Number(receiveModal.line.receivedQty)}{receiveModal.line.unit || ''}</>
                )}
              </span>
            </div>

            <div className="form-group">
              <label>입고 수량 *</label>
              <input
                type="number"
                min="0"
                max={Number(receiveModal.line.qty) || 0}
                step="any"
                value={receiveForm.qty}
                onChange={(e) => setReceiveForm({ ...receiveForm, qty: e.target.value })}
                required
                autoFocus
              />
              <p className="field-hint">
                전체 {Number(receiveModal.line.qty) || 0}{receiveModal.line.unit || ''} 중 실제 입고된 수량을 입력하세요. 부분 입고 가능.
              </p>
            </div>
            <div className="form-group">
              <label>입고일 *</label>
              <input
                type="date"
                value={receiveForm.date}
                onChange={(e) => setReceiveForm({ ...receiveForm, date: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>검수 메모</label>
              <textarea
                value={receiveForm.note}
                onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })}
                rows={2}
                placeholder="수량 확인 · 하자 여부 등"
              />
            </div>
            <p className="field-hint">
              모든 라인이 발주 수량만큼 입고되면 전체 상태가 '입고완료'로 자동 전환됩니다.
              일부만 입고되면 '부분입고'로 표시됩니다.
            </p>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary">저장</button>
              <button type="button" className="btn btn-outline" onClick={() => setReceiveModal(null)}>취소</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
