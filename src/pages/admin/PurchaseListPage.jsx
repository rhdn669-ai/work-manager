import { useState, useEffect, useMemo } from 'react';
import {
  getPurchases, addPurchase, updatePurchase, deletePurchase, setPurchaseStatus,
  settlePurchase, getSuppliers, getPurchaseItems, getPurchaseConfig, setHqSite,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from '../../components/common/DialogProvider';
import Modal from '../../components/common/Modal';

const STATUS = {
  ordered: { label: '발주', cls: 'ordered' },
  received: { label: '입고', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
};

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'ordered', label: '발주' },
  { key: 'received', label: '입고' },
  { key: 'settled', label: '정산완료' },
];

const EMPTY_LINE = { itemId: '', name: '', spec: '', unit: '', qty: 1, unitPrice: 0 };
const EMPTY_FORM = {
  title: '', ownerType: 'hq', siteId: '', supplierId: '',
  items: [{ ...EMPTY_LINE }], note: '',
};

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

export default function PurchaseListPage() {
  const { userProfile } = useAuth();
  const { confirm, alert } = useDialog();

  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [sites, setSites] = useState([]);
  const [hqSiteId, setHqSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const [formModal, setFormModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState(null);
  const [receiveModal, setReceiveModal] = useState(null);
  const [receiveForm, setReceiveForm] = useState({ date: todayStr(), note: '' });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [p, sp, im, st, cfg] = await Promise.all([
        getPurchases(), getSuppliers(), getPurchaseItems(), getAllSites(), getPurchaseConfig(),
      ]);
      // 워크플로우 간소화 이전 상태값(requested 등) → ordered 자동 보정
      const validStatus = ['ordered', 'received', 'settled'];
      const legacy = p.filter((x) => !validStatus.includes(x.status));
      if (legacy.length > 0) {
        await Promise.all(legacy.map((x) => setPurchaseStatus(x.id, 'ordered')));
        legacy.forEach((x) => { x.status = 'ordered'; });
      }
      setPurchases(p);
      setSuppliers(sp);
      setItemMaster(im);
      setSites(st);
      setHqSiteId(cfg.hqSiteId || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    const c = { all: purchases.length };
    for (const p of purchases) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [purchases]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return purchases.filter((p) => {
      if (tab !== 'all' && p.status !== tab) return false;
      if (!kw) return true;
      return [p.title, p.supplierName, p.siteName, p.requesterName]
        .some((v) => (v || '').toLowerCase().includes(kw));
    });
  }, [purchases, tab, search]);

  // ---- 작성/수정 ----
  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_LINE }], ownerType: 'hq', siteId: hqSiteId || '' });
    setFormModal(true);
  }

  function openEdit(p) {
    setEditTarget(p);
    setForm({
      title: p.title || '',
      ownerType: p.ownerType || 'hq',
      siteId: p.siteId || '',
      supplierId: p.supplierId || '',
      items: (p.items && p.items.length > 0)
        ? p.items.map((it) => ({ ...EMPTY_LINE, ...it }))
        : [{ ...EMPTY_LINE }],
      note: p.note || '',
    });
    setDetail(null);
    setFormModal(true);
  }

  function updateLine(idx, patch) {
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)),
    }));
  }

  function pickItem(idx, itemId) {
    const m = itemMaster.find((x) => x.id === itemId);
    if (!m) { updateLine(idx, { itemId: '', name: '', spec: '', unit: '' }); return; }
    updateLine(idx, {
      itemId: m.id, name: m.name, spec: m.spec || '', unit: m.unit || '',
      unitPrice: Number(m.standardPrice) || 0,
    });
  }

  function addLine() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_LINE }] }));
  }

  function removeLine(idx) {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }));
  }

  const formTotal = useMemo(
    () => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0),
    [form.items],
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { alert('구매 제목을 입력해주세요.'); return; }
    if (!form.siteId) {
      alert(form.ownerType === 'hq' ? '본사 귀속 프로젝트를 선택해주세요.' : '귀속 프로젝트를 선택해주세요.');
      return;
    }
    const lines = form.items.filter((ln) => ln.itemId);
    if (lines.length === 0) { alert('품목을 1개 이상 선택해주세요.'); return; }

    const items = lines.map((ln) => ({
      itemId: ln.itemId, name: ln.name, spec: ln.spec, unit: ln.unit,
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      amount: (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0),
    }));
    const totalAmount = items.reduce((s, it) => s + it.amount, 0);
    const site = sites.find((s) => s.id === form.siteId);

    const payload = {
      title: form.title.trim(),
      items,
      supplierId: form.supplierId,
      supplierName: suppliers.find((s) => s.id === form.supplierId)?.name || '',
      ownerType: form.ownerType,
      siteId: form.siteId,
      siteName: site?.name || '',
      totalAmount,
      note: form.note,
    };

    try {
      if (editTarget) {
        await updatePurchase(editTarget.id, payload);
      } else {
        await addPurchase({
          ...payload,
          requesterId: userProfile?.uid || '',
          requesterName: userProfile?.name || '',
        });
      }
      if (form.ownerType === 'hq' && form.siteId !== hqSiteId) {
        await setHqSite(form.siteId, site?.name || '');
        setHqSiteId(form.siteId);
      }
      setFormModal(false);
      await loadData();
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  }

  // ---- 입고 / 정산 ----
  function openReceive(p) {
    setDetail(null);
    setReceiveForm({ date: todayStr(), note: '' });
    setReceiveModal(p);
  }

  async function submitReceive(e) {
    e.preventDefault();
    const p = receiveModal;
    if (!p) return;
    try {
      await setPurchaseStatus(p.id, 'received', {
        receivedAt: new Date(receiveForm.date),
        receivedBy: userProfile?.name || '',
        receiveNote: receiveForm.note,
      });
      setReceiveModal(null);
      await loadData();
    } catch (err) {
      alert('입고 처리 중 오류: ' + err.message);
    }
  }

  async function handleSettle(p) {
    const where = p.siteName || '귀속 프로젝트';
    if (!await confirm(
      `"${p.title}" 건을 정산하시겠습니까?\n금액 ${Number(p.totalAmount || 0).toLocaleString()}원이 ${where} 지출로 자동 등록됩니다.`,
    )) return;
    try {
      await settlePurchase(p, userProfile?.name || '');
      setDetail(null);
      await loadData();
    } catch (err) {
      alert('정산 중 오류: ' + err.message);
    }
  }

  async function handleDelete(p) {
    if (!await confirm(`"${p.title}" 구매 건을 삭제하시겠습니까?`)) return;
    try {
      await deletePurchase(p.id);
      setDetail(null);
      await loadData();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-list-page">
      <div className="page-header">
        <h2>구매 · 발주 현황</h2>
        <button className="btn btn-primary" onClick={openCreate}>구매 등록</button>
      </div>

      <div className="tab-nav closing-tab-nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-nav-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span style={{ opacity: 0.55, marginLeft: 3, fontSize: '0.85em' }}>{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="form-group" style={{ maxWidth: 320 }}>
        <input
          type="text"
          placeholder="제목 · 구매처 · 프로젝트 · 등록자 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm" style={{ padding: '12px 0' }}>
          {purchases.length === 0 ? '등록된 구매 건이 없습니다.' : '해당 조건의 구매 건이 없습니다.'}
        </p>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>제목</th>
              <th>구매처</th>
              <th>귀속</th>
              <th>금액</th>
              <th>상태</th>
              <th>등록자</th>
              <th>발주일</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="table-clickable-row" onClick={() => setDetail(p)} style={{ cursor: 'pointer' }}>
                <td data-label="제목"><strong>{p.title}</strong></td>
                <td data-label="구매처">{p.supplierName || '-'}</td>
                <td data-label="귀속">
                  {p.ownerType === 'hq' ? `본사 · ${p.siteName || '-'}` : (p.siteName || '프로젝트')}
                </td>
                <td data-label="금액">{Number(p.totalAmount || 0).toLocaleString()}원</td>
                <td data-label="상태">
                  <span className={`purchase-badge purchase-badge-${STATUS[p.status]?.cls || 'ordered'}`}>
                    {STATUS[p.status]?.label || p.status}
                  </span>
                </td>
                <td data-label="등록자">{p.requesterName || '-'}</td>
                <td data-label="발주일">{fmtDate(p.orderedAt || p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 작성/수정 모달 */}
      <Modal
        isOpen={formModal}
        onClose={() => setFormModal(false)}
        title={editTarget ? '구매 수정' : '구매 등록'}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>제목 *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>

          <div className="form-group">
            <label>귀속</label>
            <div className="purchase-owner-toggle">
              <button
                type="button"
                className={`btn btn-sm ${form.ownerType === 'hq' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setForm({ ...form, ownerType: 'hq', siteId: hqSiteId || form.siteId })}
              >본사</button>
              <button
                type="button"
                className={`btn btn-sm ${form.ownerType === 'site' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setForm({ ...form, ownerType: 'site', siteId: '' })}
              >프로젝트</button>
            </div>
          </div>

          <div className="form-group">
            <label>{form.ownerType === 'hq' ? '본사 귀속 프로젝트 *' : '프로젝트 *'}</label>
            <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">선택</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {form.ownerType === 'hq' && (
              <p className="field-hint">본사 업무 구매가 귀속될 프로젝트입니다. 선택값은 다음에도 기억됩니다.</p>
            )}
          </div>

          <div className="form-group">
            <label>구매처</label>
            <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">선택</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>품목</label>
            {itemMaster.length === 0 && (
              <p className="field-hint">먼저 "구매 품목 관리"에서 품목을 등록해주세요.</p>
            )}
            {form.items.map((ln, idx) => (
              <div className="purchase-line" key={idx}>
                <select
                  className="purchase-line-item"
                  value={ln.itemId}
                  onChange={(e) => pickItem(idx, e.target.value)}
                >
                  <option value="">품목 선택</option>
                  {itemMaster.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.spec ? ` (${m.spec})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  className="purchase-line-qty"
                  type="number" min="0" placeholder="수량"
                  value={ln.qty}
                  onChange={(e) => updateLine(idx, { qty: e.target.value })}
                />
                <input
                  className="purchase-line-price"
                  type="number" min="0" placeholder="단가"
                  value={ln.unitPrice}
                  onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                />
                <span className="purchase-line-amount">
                  {((Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0)).toLocaleString()}
                </span>
                <button type="button" className="closing-delete" onClick={() => removeLine(idx)} aria-label="행 삭제">✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-outline" onClick={addLine} style={{ marginTop: 6 }}>
              + 품목 추가
            </button>
          </div>

          <div className="purchase-total-row">
            <span>합계</span>
            <strong>{formTotal.toLocaleString()}원</strong>
          </div>

          <div className="form-group">
            <label>메모</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
          </div>

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editTarget ? '수정' : '등록'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setFormModal(false)}>취소</button>
          </div>
        </form>
      </Modal>

      {/* 상세 모달 */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title="구매 상세">
        {detail && (
          <div className="purchase-detail">
            <div className="purchase-detail-head">
              <strong className="purchase-detail-title">{detail.title}</strong>
              <span className={`purchase-badge purchase-badge-${STATUS[detail.status]?.cls || 'ordered'}`}>
                {STATUS[detail.status]?.label || detail.status}
              </span>
            </div>

            <div className="purchase-detail-meta">
              <div><span className="label">귀속</span>{detail.ownerType === 'hq' ? `본사 · ${detail.siteName || '-'}` : (detail.siteName || '프로젝트')}</div>
              <div><span className="label">구매처</span>{detail.supplierName || '-'}</div>
              <div><span className="label">등록자</span>{detail.requesterName || '-'}</div>
              <div><span className="label">발주일</span>{fmtDate(detail.orderedAt || detail.createdAt)}</div>
              {detail.receivedBy && <div><span className="label">입고</span>{detail.receivedBy} · {fmtDate(detail.receivedAt)}</div>}
              {detail.settledBy && <div><span className="label">정산</span>{detail.settledBy} · {fmtDate(detail.settledAt)}</div>}
            </div>

            <table className="table purchase-detail-items">
              <thead>
                <tr><th>품목</th><th>수량</th><th>단가</th><th>금액</th></tr>
              </thead>
              <tbody>
                {(detail.items || []).map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}{it.spec ? ` (${it.spec})` : ''}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.qty || 0).toLocaleString()}{it.unit || ''}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.unitPrice || 0).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.amount || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="purchase-total-row">
              <span>합계</span>
              <strong>{Number(detail.totalAmount || 0).toLocaleString()}원</strong>
            </div>

            {detail.note && <p className="purchase-detail-note">{detail.note}</p>}
            {detail.receiveNote && (
              <p className="purchase-detail-note">검수 메모: {detail.receiveNote}</p>
            )}

            <div className="modal-actions purchase-detail-actions">
              {detail.status === 'ordered' && (
                <>
                  <button className="btn btn-primary" onClick={() => openReceive(detail)}>입고 처리</button>
                  <button className="btn btn-outline" onClick={() => openEdit(detail)}>수정</button>
                  <button className="btn btn-outline" onClick={() => handleDelete(detail)}>삭제</button>
                </>
              )}
              {detail.status === 'received' && (
                <button className="btn btn-primary" onClick={() => handleSettle(detail)}>정산 처리</button>
              )}
              {detail.status === 'settled' && (
                <p className="field-hint">
                  정산 완료 — {detail.siteName || '귀속 프로젝트'} 지출에 반영됨
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 입고 검수 모달 */}
      <Modal isOpen={!!receiveModal} onClose={() => setReceiveModal(null)} title="입고 검수">
        <form onSubmit={submitReceive}>
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
          <p className="field-hint">입고일이 속한 월의 지출로 정산됩니다.</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">입고 완료</button>
            <button type="button" className="btn btn-outline" onClick={() => setReceiveModal(null)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
